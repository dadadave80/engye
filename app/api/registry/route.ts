// Provider registry: POST = register + probe (well-formed 402 → one real paid call →
// validator-scored reputation prior). GET = public list.
// ERC-8004 integration: a claimed agent_id is verified against the on-chain Identity registry
// (wallet must be the agent's wallet/owner), and POST {agent_id} alone imports the agent —
// card read from tokenURI, endpoint from the card, payout wallet from the chain.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/db";
import { quotePrice, payEndpoint, ensureGatewayFloat } from "@/lib/x402";
import { validateDeliverable } from "@/lib/validator";
import { assertPublicHttpsUrl } from "@/lib/ssrf";
import { limited } from "@/lib/ratelimit";
import { usdcBalance } from "@/lib/escrow";
import { readAgentIdentity, verifyAgentWallet } from "@/lib/erc8004";
import { parseAgentCard } from "@/lib/agentCard";

export const maxDuration = 60;

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  endpoint_url: z.string().url().startsWith("https://"),
  price_usdc: z.number().positive().max(1),
  capabilities: z.array(z.string().min(1)).min(1).max(12),
  description: z.string().max(2000).optional(),
  wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  agent_card_url: z.string().url().optional(),
  agent_id: z.number().int().positive().optional(), // ERC-8004 identity, if registered
});

const PROBE_TASK = {
  type: "question-answering",
  spec: "Registry probe: what is 17 + 25? Reply with the number and one short sentence.",
};

const PROBE_MAX_USDC = Number(process.env.PROBE_MAX_USDC ?? 0.02); // hard ceiling on treasury spent per probe
const MIN_TREASURY_USDC = 1.0; // mirror lib/broker.ts circuit-breaker floor

export async function GET(): Promise<NextResponse> {
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  const { data } = await supabaseAdmin
    .from("providers")
    .select("id,name,capabilities,price_usdc,trials,passes,avg_score,total_earned_usdc,slashes_caused,in_house,active,agent_id")
    .eq("active", true)
    .order("created_at");
  return NextResponse.json({ providers: data ?? [] });
}

// import-by-agentId: the whole registration derived from the ERC-8004 identity on-chain
const importSchema = z.object({ agent_id: z.number().int().positive() }).strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  // strict: each probe spends real treasury USDC paying the endpoint — 5/hour/IP
  const rl = limited(req, "registry", 5, 3_600_000);
  if (rl) return rl;
  const body = await req.json().catch(() => null);

  // ---- import mode: POST {agent_id} — everything else comes from the chain + agent card ----
  const imp = importSchema.safeParse(body);
  let p: z.infer<typeof registerSchema>;
  if (imp.success) {
    const agentId = BigInt(imp.data.agent_id);
    let identity: Awaited<ReturnType<typeof readAgentIdentity>>;
    try {
      identity = await readAgentIdentity(agentId);
    } catch {
      return NextResponse.json({ error: "unknown agent", detail: `agent #${imp.data.agent_id} not found in the ERC-8004 Identity registry` }, { status: 422 });
    }
    try {
      await assertPublicHttpsUrl(identity.uri);
    } catch {
      return NextResponse.json({ error: "bad agent card", detail: "agent tokenURI is not a public https URL" }, { status: 422 });
    }
    const cardRes = await fetch(identity.uri, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const cardJson = cardRes?.ok ? await cardRes.json().catch(() => null) : null;
    const card = cardJson ? parseAgentCard(cardJson, identity.uri, agentId) : null;
    if (!card) {
      return NextResponse.json({ error: "bad agent card", detail: "card unreachable, malformed, or missing an https endpoints.service" }, { status: 422 });
    }
    // price is whatever the endpoint's own 402 advertises (still probe-capped below)
    let advertised: number;
    try {
      advertised = await quotePrice(card.endpoint, { method: "POST", body: JSON.stringify(PROBE_TASK) });
    } catch {
      return NextResponse.json({ error: "probe failed", detail: "endpoint did not answer a well-formed 402" }, { status: 422 });
    }
    p = {
      name: card.name,
      endpoint_url: card.endpoint,
      price_usdc: advertised,
      capabilities: card.capabilities,
      description: card.description ?? undefined,
      wallet_address: identity.wallet, // chain truth — payouts go to the agent's on-chain wallet
      agent_card_url: identity.uri,
      agent_id: imp.data.agent_id,
    };
  } else {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
    }
    p = parsed.data;
    // a claimed ERC-8004 identity must check out on-chain (wallet == agent wallet/owner)
    if (p.agent_id) {
      const ok = await verifyAgentWallet(BigInt(p.agent_id), p.wallet_address).catch(() => false);
      if (!ok) {
        return NextResponse.json(
          { error: "identity mismatch", detail: `wallet is not the on-chain wallet/owner of ERC-8004 agent #${p.agent_id}` },
          { status: 422 },
        );
      }
    }
  }

  if (p.price_usdc > PROBE_MAX_USDC) {
    return NextResponse.json(
      { error: "price too high", detail: `probe price is capped at $${PROBE_MAX_USDC}; contact ENGYE for higher-priced onboarding` },
      { status: 422 },
    );
  }

  // SSRF guard: reject before any server-side request to the submitted URL
  try {
    await assertPublicHttpsUrl(p.endpoint_url);
  } catch (e) {
    return NextResponse.json(
      { error: "endpoint rejected", detail: e instanceof Error ? e.message : "invalid endpoint" },
      { status: 422 },
    );
  }

  // already-registered: metadata-only update — never re-run the paid probe for a URL we've already probed
  const { data: existing } = await supabaseAdmin
    .from("providers").select("id").eq("endpoint_url", p.endpoint_url).maybeSingle();
  if (existing) {
    await supabaseAdmin.from("providers").update({
      name: p.name, capabilities: p.capabilities, description: p.description ?? null,
      wallet_address: p.wallet_address, agent_card_url: p.agent_card_url ?? null, agent_id: p.agent_id ?? null,
    }).eq("id", existing.id);
    return NextResponse.json({ provider_id: existing.id, updated: true }, { status: 200 });
  }

  try {
    // 1) well-formed 402?
    const advertised = await quotePrice(p.endpoint_url, { method: "POST", body: JSON.stringify(PROBE_TASK) });
    if (Math.abs(advertised - p.price_usdc) > 1e-9) {
      return NextResponse.json(
        { error: "probe failed", detail: `endpoint advertises $${advertised}, registration says $${p.price_usdc}` },
        { status: 422 },
      );
    }
    // 2) one real paid probe call (ENGYE treasury pays) — gated on a healthy treasury float
    const bal = await usdcBalance(process.env.BROKER_ADDRESS as `0x${string}`);
    if (bal < MIN_TREASURY_USDC + p.price_usdc) {
      return NextResponse.json({ error: "onboarding paused", detail: "treasury below safety floor — try later" }, { status: 503 });
    }
    await ensureGatewayFloat(process.env.BROKER_PRIVATE_KEY!);
    const { result } = await payEndpoint(p.endpoint_url, p.price_usdc, process.env.BROKER_PRIVATE_KEY!, {
      method: "POST",
      body: JSON.stringify(PROBE_TASK),
    });
    // 3) validator scores the probe deliverable → reputation prior
    const v = await validateDeliverable(PROBE_TASK.spec, undefined, result.data);
    const prior = Math.max(0.5, Math.min(0.85, 0.5 + (v.score / 100) * 0.35));

    const { data: row, error } = await supabaseAdmin
      .from("providers")
      .upsert(
        {
          name: p.name,
          endpoint_url: p.endpoint_url,
          price_usdc: p.price_usdc,
          capabilities: p.capabilities,
          description: p.description ?? null,
          wallet_address: p.wallet_address,
          agent_card_url: p.agent_card_url ?? null,
          agent_id: p.agent_id ?? null,
          in_house: false,
          active: true,
          reputation_prior: prior,
          trials: 2, // probe as Bayesian pseudo-counts
          passes: v.pass ? 2 : 1,
        },
        { onConflict: "endpoint_url" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { provider_id: row.id, reputation_prior: prior, probe_score: v.score, probe_pass: v.pass },
      { status: 201 },
    );
  } catch (e) {
    // don't echo upstream response bodies back to the caller — log server-side, return a generic reason
    console.error("[registry] probe failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: "probe failed", detail: "endpoint did not complete a valid paid x402 probe" },
      { status: 422 },
    );
  }
}
