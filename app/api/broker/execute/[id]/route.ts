// x402-protected execution of an accepted quote — the full ENGYE lifecycle:
// pay ENGYE (rail A, inbound) → bond + decision hash on-chain → ERC-8004 validationRequest
// → pay provider (rail A, outbound) → blind validation → ERC-8004 validationResponse
// → release | slash + stake-slash + vault refund (rail B) → ERC-8004 giveFeedback.
// One bytes32 matchKey links every step. If this process dies mid-match, the bond's
// permissionless claim_timeout() protects the requester.
import { NextRequest, NextResponse, after } from "next/server";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { supabaseAdmin } from "@/lib/db";
import { buildRequirements, paymentRequired, verifyAndSettle, payEndpoint, ensureGatewayFloat } from "@/lib/x402";
import { createBond, arcscanTx } from "@/lib/escrow";
import { requestValidation } from "@/lib/erc8004";
import { MATCH_TTL_SECONDS, VERDICT_WINDOW_SECONDS } from "@/lib/economics";
import { settleMatch } from "@/lib/settle";

export const maxDuration = 300;

/** In-house provider wallets we can sign for (external providers: undefined). */
function pkForWallet(wallet: string): string | undefined {
  for (const n of ["PROVIDER1", "PROVIDER2", "PROVIDER3"]) {
    if (process.env[`${n}_ADDRESS`]?.toLowerCase() === wallet.toLowerCase()) {
      return process.env[`${n}_PRIVATE_KEY`];
    }
  }
  return undefined;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });

  const { data: quote } = await supabaseAdmin.from("quotes").select("*").eq("id", id).single();
  if (!quote) return NextResponse.json({ error: "quote not found" }, { status: 404 });
  if (quote.status !== "open") return NextResponse.json({ error: `quote is ${quote.status}` }, { status: 409 });
  if (new Date(quote.expires_at) < new Date()) return NextResponse.json({ error: "quote expired" }, { status: 410 });

  const { data: provider } = await supabaseAdmin.from("providers").select("*").eq("id", quote.provider_id).single();
  if (!provider) return NextResponse.json({ error: "provider missing" }, { status: 500 });

  // rail A inbound: requester pays ENGYE the quoted total (x402) OR a passkey account pays by a
  // relay-bound direct transfer (spec §5) proven via x-engye-payment-tx.
  const endpoint = `/api/broker/execute/${id}`;
  const requirements = buildRequirements(Number(quote.total_price_usdc), process.env.BROKER_ADDRESS!);
  const proofTx = req.headers.get("x-engye-payment-tx");
  let paidBy: string | null = null;
  if (proofTx) {
    // passkey rail: honor only a proof row bound to THIS quote at relay time (spec §5)
    const { data: proof } = await supabaseAdmin
      .from("payments").select("payer,quote_id").eq("gateway_tx", proofTx).eq("direction", "inbound").maybeSingle();
    if (!proof || proof.quote_id !== id) {
      return NextResponse.json({ error: "no payment bound to this quote for that tx" }, { status: 402 });
    }
    // defense-in-depth: the payer must be a provisioned passkey account, not just any address that
    // happens to match a payments row (cheap extra check on the money path).
    const { data: passkeyAccount } = await supabaseAdmin
      .from("passkey_accounts").select("account").eq("account", proof.payer.toLowerCase()).maybeSingle();
    if (!passkeyAccount) {
      return NextResponse.json({ error: "payment not from a known passkey account" }, { status: 402 });
    }
    paidBy = proof.payer;
  } else if (!req.headers.get("payment-signature")) {
    return paymentRequired(endpoint, requirements);
  }

  // atomic claim BEFORE taking payment — a concurrent retry of the same quote can't double-execute
  // (conditional update: only the request that flips open→executing proceeds).
  const { data: claimed } = await supabaseAdmin
    .from("quotes").update({ status: "executing" }).eq("id", id).eq("status", "open").select();
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "quote already claimed, executed, or expired" }, { status: 409 });
  }

  if (!paidBy) {
    const paid = await verifyAndSettle(req, requirements, endpoint, "inbound");
    if (!paid.ok) {
      await supabaseAdmin.from("quotes").update({ status: "open" }).eq("id", id); // release for retry
      return NextResponse.json({ error: paid.error }, { status: paid.status });
    }
    paidBy = paid.payer;
  }
  const requester = (quote.requester_wallet ?? paidBy) as Address;
  const bonded = quote.action === "accept";
  const matchKey = keccak256(toBytes(`${id}:${Date.now()}`)) as Hex;
  const startedAt = Date.now();

  const { data: decisionRow } = await supabaseAdmin
    .from("decisions").select("raw_json,derived,prompt_hash,model")
    .eq("quote_id", id).eq("kind", "broker_quote").single();
  const decisionJson = JSON.stringify({
    quote_id: id, decision: decisionRow?.raw_json ?? null, derived: decisionRow?.derived ?? null,
    prompt_hash: decisionRow?.prompt_hash ?? null, model: decisionRow?.model ?? null,
  });

  const { data: match } = await supabaseAdmin
    .from("matches")
    .insert({
      quote_id: id, provider_id: provider.id, match_key: matchKey, status: "pending",
      decision_json: JSON.parse(decisionJson), bond_usdc: quote.bond_usdc,
      price_usdc: quote.total_price_usdc,
      source: req.nextUrl.searchParams.get("source") ?? req.headers.get("x-engye-source") ?? "organic",
    })
    .select().single();
  await supabaseAdmin.from("quotes").update({ status: "executed" }).eq("id", id); // was 'executing'

  const txs: Record<string, string> = {};
  try {
    // bond with the decision hash committed before money moves
    if (bonded) {
      txs.bond_tx = await createBond(matchKey, Number(quote.bond_usdc), requester, decisionJson, MATCH_TTL_SECONDS);
      // ERC-8004: only the agent's owner may request validation — in-house providers
      // file their own request (we hold their keys); external providers do it at onboarding.
      const providerPk = pkForWallet(provider.wallet_address);
      if (provider.agent_id && providerPk) {
        txs.validation_request_tx = await requestValidation({
          providerAgentId: BigInt(provider.agent_id),
          requestURI: `${process.env.APP_URL}/m/${matchKey}`,
          matchKey,
          providerPrivateKey: providerPk,
        });
      }
      await supabaseAdmin.from("matches").update({ status: "bonded", bond_tx: txs.bond_tx, validation_request_tx: txs.validation_request_tx ?? null }).eq("id", match.id);
    }

    // rail A outbound: ENGYE pays the provider
    await ensureGatewayFloat(process.env.BROKER_PRIVATE_KEY!);
    const { result } = await payEndpoint(
      provider.endpoint_url,
      Number(provider.price_usdc),
      process.env.BROKER_PRIVATE_KEY!,
      { method: "POST", body: JSON.stringify(quote.task) },
    );
    const deliverable = result.data;
    txs.pay_tx = String(result.transaction ?? "");
    await supabaseAdmin.from("matches").update({ status: "paid", pay_tx: txs.pay_tx, deliverable }).eq("id", match.id);

    // Phase A ends at delivery: verdict + settlement run after the public window (spec §3.1-3.2)
    const verdictDueAt = new Date(Date.now() + VERDICT_WINDOW_SECONDS * 1000).toISOString();
    await supabaseAdmin.from("matches").update({
      status: "awaiting_verdict", verdict_due_at: verdictDueAt, requester_wallet: requester,
    }).eq("id", match.id);

    if (process.env.ENGYE_DISABLE_AFTER !== "1") {
      after(async () => {
        await new Promise((r) => setTimeout(r, VERDICT_WINDOW_SECONDS * 1000 + 1_000));
        try { await settleMatch(match.id); } catch (e) { console.error(`[execute ${id}] phase B:`, e); }
      });
    }

    if (!bonded) {
      return NextResponse.json({
        match_id: match.id, match_key: matchKey, status: "delivered", deliverable,
        tier: "best_effort_unbonded", watch_url: `/m/${matchKey}`,
      });
    }
    return NextResponse.json({
      match_id: match.id, match_key: matchKey, status: "delivered_awaiting_verdict", deliverable,
      verdict_due_at: verdictDueAt, watch_url: `/m/${matchKey}`, bond_tx: arcscanTx(txs.bond_tx),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[execute ${id}] lifecycle error:`, message);
    await supabaseAdmin.from("matches").update({ status: "error" }).eq("id", match.id);
    return NextResponse.json(
      { error: "lifecycle failed", message, match_key: matchKey,
        note: "if a bond was posted, claim_timeout() releases it to the requester after the deadline" },
      { status: 500 },
    );
  }
}
