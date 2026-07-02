// Dashboard data layer — reads the public tables and shapes them for the UI.
import { supabasePublic } from "./supabase/public";

export type UiStatus = "PASS" | "SLASHED" | "OPEN";
export function toUiStatus(matchStatus: string): UiStatus {
  if (matchStatus === "delivered") return "PASS";
  if (matchStatus === "failed_compensated") return "SLASHED";
  return "OPEN";
}

export interface FeedRow {
  id: string;
  created_at: string;
  task: string;
  provider: string;
  confidence: number | null;
  bond: number | null;
  status: UiStatus;
  tx: string | null;
  source: string;
}

export async function getFeed(limit = 40): Promise<FeedRow[]> {
  const sb = supabasePublic();
  const { data } = await sb
    .from("matches")
    .select("id,created_at,status,bond_usdc,source,settle_tx,bond_tx,providers(name),quotes(task,confidence)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((m: Record<string, any>) => ({
    id: m.id,
    created_at: m.created_at,
    task: m.quotes?.task?.type ?? "task",
    provider: m.providers?.name ?? "—",
    confidence: m.quotes?.confidence ?? null,
    bond: m.bond_usdc,
    status: toUiStatus(m.status),
    tx: m.settle_tx ?? m.bond_tx ?? null,
    source: m.source ?? "organic",
  }));
}

export interface Totals {
  matchesSettled: number;
  usdcSettled: number;
  bondsAtRisk: number;
  slashesCompensated: number;
  organic: number;
  demand: number;
  openCount: number;
  paidCount: number;
}

export async function getTotals(): Promise<Totals> {
  const sb = supabasePublic();
  const { data } = await sb.from("matches").select("status,price_usdc,bond_usdc,source");
  const rows = data ?? [];
  const settled = rows.filter((r) => r.status === "delivered" || r.status === "failed_compensated");
  return {
    matchesSettled: settled.length,
    usdcSettled: settled.reduce((s, r) => s + Number(r.price_usdc ?? 0), 0),
    bondsAtRisk: rows.filter((r) => r.status === "bonded" || r.status === "paid").reduce((s, r) => s + Number(r.bond_usdc ?? 0), 0),
    slashesCompensated: rows.filter((r) => r.status === "failed_compensated").reduce((s, r) => s + Number(r.bond_usdc ?? 0), 0),
    organic: settled.filter((r) => r.source !== "demand_agent").length,
    demand: settled.filter((r) => r.source === "demand_agent").length,
    openCount: rows.filter((r) => r.status === "pending" || r.status === "bonded").length,
    paidCount: rows.filter((r) => ["paid", "delivered", "failed_compensated"].includes(r.status)).length,
  };
}

export interface DecisionItem {
  id: string;
  headline: string;
  body: string;
  chips: string[];
}

export async function getRecentDecisions(limit = 6): Promise<DecisionItem[]> {
  const sb = supabasePublic();
  const { data } = await sb
    .from("quotes")
    .select("id,action,provider_id,confidence,decline_reason,reasoning,total_price_usdc,bond_usdc,providers(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((q: Record<string, any>) => {
    const name = q.providers?.name ?? "provider";
    const headline =
      q.action === "decline"
        ? "Declined"
        : q.action === "best_effort_offer"
          ? `Best-effort offer · ${name}`
          : `Matched ${name} at ĉ ${Number(q.confidence ?? 0).toFixed(2)}`;
    return {
      id: q.id,
      headline,
      body: q.action === "decline" ? q.decline_reason ?? q.reasoning ?? "declined" : q.reasoning ?? "",
      chips: [q.action === "accept" ? `bond ${Number(q.bond_usdc ?? 0).toFixed(3)}` : q.action, name],
    };
  });
}

export interface CalibrationBucket {
  stated: number;
  realized: number;
  n: number;
}

export async function getCalibration(): Promise<CalibrationBucket[]> {
  const sb = supabasePublic();
  const { data } = await sb
    .from("matches")
    .select("status,quotes(confidence)")
    .in("status", ["delivered", "failed_compensated"]);
  const rows = (data ?? []) as unknown as Array<{ status: string; quotes: { confidence: number | null } | null }>;
  const buckets: CalibrationBucket[] = [];
  for (let lo = 0.5; lo < 1.0 - 1e-9; lo += 0.05) {
    const hi = lo + 0.05;
    const inBucket = rows.filter((r) => {
      const c = r.quotes?.confidence;
      return c != null && c >= lo && c < (hi >= 0.999 ? 1.001 : hi);
    });
    const passes = inBucket.filter((r) => r.status === "delivered").length;
    buckets.push({
      stated: Math.round((lo + 0.025) * 100) / 100,
      realized: inBucket.length ? passes / inBucket.length : 0,
      n: inBucket.length,
    });
  }
  return buckets;
}

export interface ProviderRow {
  id: string;
  name: string;
  confidence: number;
  trials: number;
  passRate: string;
  earned: number;
  avgLatencyMs: number | null;
  slashes: number;
  wallet: string;
  inHouse: boolean;
}

export async function getProviders(): Promise<ProviderRow[]> {
  const sb = supabasePublic();
  const { data } = await sb.from("providers").select("*").eq("active", true);
  return (data ?? [])
    .map((p: Record<string, any>) => ({
      id: p.id,
      name: p.name,
      confidence: (p.passes + 2) / (p.trials + 4),
      trials: p.trials,
      passRate: p.trials ? `${((p.passes / p.trials) * 100).toFixed(1)}%` : "—",
      earned: Number(p.total_earned_usdc ?? 0),
      avgLatencyMs: p.avg_latency_ms,
      slashes: p.slashes_caused,
      wallet: p.wallet_address,
      inHouse: p.in_house,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
