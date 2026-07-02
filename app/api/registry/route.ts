// Provider registry: POST = register + probe (well-formed 402 → one real paid call →
// validator-scored reputation prior). GET = public list.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/db";
import { quotePrice, payEndpoint, ensureGatewayFloat } from "@/lib/x402";
import { validateDeliverable } from "@/lib/validator";

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

export async function GET(): Promise<NextResponse> {
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  const { data } = await supabaseAdmin
    .from("providers")
    .select("id,name,capabilities,price_usdc,trials,passes,avg_score,total_earned_usdc,slashes_caused,in_house,active,agent_id")
    .eq("active", true)
    .order("created_at");
  return NextResponse.json({ providers: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  const p = parsed.data;

  try {
    // 1) well-formed 402?
    const advertised = await quotePrice(p.endpoint_url, { method: "POST", body: JSON.stringify(PROBE_TASK) });
    if (Math.abs(advertised - p.price_usdc) > 1e-9) {
      return NextResponse.json(
        { error: "probe failed", detail: `endpoint advertises $${advertised}, registration says $${p.price_usdc}` },
        { status: 422 },
      );
    }
    // 2) one real paid probe call (ENGYE treasury pays)
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
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "probe failed", detail: message }, { status: 422 });
  }
}
