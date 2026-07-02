// Provider reputation: snapshot for the broker's context window, aggregate updates after settle.
import { supabaseAdmin } from "./db";
import { calibratedConfidence } from "./economics";

export interface ProviderRow {
  id: string;
  name: string;
  endpoint_url: string;
  price_usdc: number;
  capabilities: string[];
  description: string | null;
  wallet_address: string;
  agent_id: number | null;
  in_house: boolean;
  active: boolean;
  trials: number;
  passes: number;
  avg_score: number | null;
  avg_latency_ms: number | null;
  total_earned_usdc: number;
  slashes_caused: number;
  reputation_prior: number | null;
}

export async function activeProviders(): Promise<ProviderRow[]> {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  const { data, error } = await supabaseAdmin.from("providers").select("*").eq("active", true);
  if (error) throw new Error(`providers query: ${error.message}`);
  return (data ?? []) as ProviderRow[];
}

/** Compact registry table + recent outcomes — the broker's whole world view (plan §11). */
export async function brokerContext(): Promise<{ providers: ProviderRow[]; table: string }> {
  const providers = await activeProviders();
  const recent = supabaseAdmin
    ? (
        await supabaseAdmin
          .from("matches")
          .select("provider_id,status,created_at")
          .in("status", ["delivered", "failed_compensated"])
          .order("created_at", { ascending: false })
          .limit(40)
      ).data ?? []
    : [];
  const lastOutcomes = (id: string) =>
    recent
      .filter((m) => m.provider_id === id)
      .slice(0, 5)
      .map((m) => (m.status === "delivered" ? "P" : "F"))
      .join("") || "-";
  // short aliases (P1, P2, …) — LLMs mis-transcribe UUIDs; the server maps back
  const table = providers
    .map((p, i) => {
      const cHat = calibratedConfidence(p.reputation_prior ?? 0.7, p.passes, p.trials).toFixed(2);
      return `P${i + 1} | ${p.name} | caps:${p.capabilities.join(",")} | price:$${p.price_usdc} | ĉ:${cHat} | trials:${p.trials} | avg_score:${p.avg_score ?? "-"} | ${p.slashes_caused} slashes | last5:${lastOutcomes(p.id)}`;
    })
    .join("\n");
  return { providers, table };
}

/** Post-settle aggregate update + reputation event row. */
export async function applyOutcome(opts: {
  providerId: string;
  matchId: string;
  pass: boolean;
  score: number;
  latencyMs: number;
  earnedUsdc: number;
  onchainTx?: string;
}) {
  if (!supabaseAdmin) return;
  const { data: p } = await supabaseAdmin
    .from("providers")
    .select("trials,passes,avg_score,avg_latency_ms,total_earned_usdc,slashes_caused")
    .eq("id", opts.providerId)
    .single();
  if (!p) return;
  const trials = p.trials + 1;
  await supabaseAdmin
    .from("providers")
    .update({
      trials,
      passes: p.passes + (opts.pass ? 1 : 0),
      avg_score: ((p.avg_score ?? 0) * p.trials + opts.score) / trials,
      avg_latency_ms: ((p.avg_latency_ms ?? 0) * p.trials + opts.latencyMs) / trials,
      total_earned_usdc: Number(p.total_earned_usdc) + opts.earnedUsdc,
      slashes_caused: p.slashes_caused + (opts.pass ? 0 : 1),
    })
    .eq("id", opts.providerId);
  await supabaseAdmin.from("reputation_events").insert({
    provider_id: opts.providerId,
    match_id: opts.matchId,
    passed: opts.pass,
    score: Math.round(opts.score),
    onchain_tx: opts.onchainTx ?? null,
  });
}
