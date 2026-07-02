// x402-protected execution of an accepted quote — the full ENGYE lifecycle:
// pay ENGYE (rail A, inbound) → bond + decision hash on-chain → ERC-8004 validationRequest
// → pay provider (rail A, outbound) → blind validation → ERC-8004 validationResponse
// → release | slash + stake-slash + vault refund (rail B) → ERC-8004 giveFeedback.
// One bytes32 matchKey links every step. If this process dies mid-match, the bond's
// permissionless claim_timeout() protects the requester.
import { NextRequest, NextResponse } from "next/server";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { supabaseAdmin } from "@/lib/db";
import { buildRequirements, paymentRequired, verifyAndSettle, payEndpoint, ensureGatewayFloat } from "@/lib/x402";
import { createBond, releaseBond, slashBond, slashProviderStake, refundFromTreasury, arcscanTx } from "@/lib/escrow";
import { requestValidation, respondValidation, giveFeedback, contentHash } from "@/lib/erc8004";
import { validateDeliverable } from "@/lib/validator";
import { applyOutcome } from "@/lib/reputation";
import { MATCH_TTL_SECONDS } from "@/lib/economics";

export const maxDuration = 120;

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

  // rail A inbound: requester pays ENGYE the quoted total
  const endpoint = `/api/broker/execute/${id}`;
  const requirements = buildRequirements(Number(quote.total_price_usdc), process.env.BROKER_ADDRESS!);
  if (!req.headers.get("payment-signature")) return paymentRequired(endpoint, requirements);
  const paid = await verifyAndSettle(req, requirements, endpoint, "inbound");
  if (!paid.ok) return NextResponse.json({ error: paid.error }, { status: paid.status });

  const requester = (quote.requester_wallet ?? paid.payer) as Address;
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
  await supabaseAdmin.from("quotes").update({ status: "executed" }).eq("id", id);

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

    // blind validation (LLM decision #2) + on-chain verdict from the validator's own identity
    const v = await validateDeliverable(quote.task.spec, quote.task.quality_bar, deliverable, match.id);
    await supabaseAdmin.from("validations").insert({
      match_id: match.id, pass: v.pass, score: v.score, reasons: v.reasons, model: v.model,
    });
    if (txs.validation_request_tx) {
      txs.validation_response_tx = await respondValidation({
        matchKey, score: v.score, deliverableHash: contentHash(JSON.stringify(deliverable ?? null)), passed: v.pass,
      });
    }

    // settle (rail B)
    if (bonded) {
      if (v.pass) {
        txs.settle_tx = await releaseBond(matchKey);
      } else {
        txs.slash_tx = await slashBond(matchKey);
        txs.stake_slash_tx = await slashProviderStake(matchKey, provider.wallet_address as Address, requester, Number(quote.bond_usdc));
        txs.refund_tx = await refundFromTreasury(matchKey, requester, Number(quote.total_price_usdc));
      }
    }

    // reputation: canonical registry + aggregates
    if (provider.agent_id) {
      txs.feedback_tx = await giveFeedback({
        providerAgentId: BigInt(provider.agent_id), score: v.score, passed: v.pass, matchKey,
      });
    }
    await applyOutcome({
      providerId: provider.id, matchId: match.id, pass: v.pass, score: v.score,
      latencyMs: Date.now() - startedAt, earnedUsdc: Number(provider.price_usdc), onchainTx: txs.feedback_tx,
    });

    const status = !bonded ? "delivered" : v.pass ? "delivered" : "failed_compensated";
    await supabaseAdmin.from("matches").update({
      status, latency_ms: Date.now() - startedAt, settled_at: new Date().toISOString(),
      settle_tx: txs.settle_tx ?? txs.slash_tx ?? null, refund_tx: txs.refund_tx ?? null,
      validation_response_tx: txs.validation_response_tx ?? null, feedback_tx: txs.feedback_tx ?? null,
      stake_slash_tx: txs.stake_slash_tx ?? null,
    }).eq("id", match.id);

    if (status === "failed_compensated") {
      return NextResponse.json({
        match_id: match.id, match_key: matchKey, status,
        validation: { pass: v.pass, score: v.score, reasons: v.reasons },
        slash_tx: arcscanTx(txs.slash_tx), refund_tx: arcscanTx(txs.refund_tx),
        stake_slash_tx: arcscanTx(txs.stake_slash_tx), bond_tx: arcscanTx(txs.bond_tx),
      });
    }
    return NextResponse.json({
      match_id: match.id, match_key: matchKey, status, deliverable,
      validation: { pass: v.pass, score: v.score, reasons: v.reasons },
      ...(bonded && { bond_tx: arcscanTx(txs.bond_tx), settle_tx: arcscanTx(txs.settle_tx) }),
      ...(!bonded && { tier: "best_effort_unbonded" }),
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
