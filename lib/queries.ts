// Dashboard data layer — reads the public tables and shapes them for the UI. Status semantics come
// from the lifecycle rulebook (lib/matchLifecycle.ts) — no hand-spelled status strings here.
import { supabasePublic } from "./supabase/public";
import { TERMINAL, isAtRisk, isSettled, outcome, type MatchStatus } from "./matchLifecycle";

export type UiStatus = "PASS" | "SLASHED" | "OPEN";
export function toUiStatus(matchStatus: string): UiStatus {
  const o = outcome({ status: matchStatus });
  return o === "slashed" ? "SLASHED" : o === "passed" || o === "best_effort" ? "PASS" : "OPEN";
}

// dashboard-local stage groups, typed against the rulebook so a status rename is a compile error
const OPEN_STAGES: readonly MatchStatus[] = ["pending", "bonded"];
const PAID_STAGES: readonly MatchStatus[] = ["paid", ...TERMINAL];

export interface FeedRow {
  id: string;
  created_at: string;
  task: string;
  provider: string;
  confidence: number | null;
  bond: number | null;
  price: number | null;
  status: UiStatus;
  tx: string | null;
  source: string;
}

export async function getFeed(limit = 40): Promise<FeedRow[]> {
  const sb = supabasePublic();
  const { data } = await sb
    .from("matches")
    .select("id,created_at,status,bond_usdc,price_usdc,source,settle_tx,bond_tx,providers(name),quotes(task,confidence)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((m: Record<string, any>) => ({
    id: m.id,
    created_at: m.created_at,
    task: m.quotes?.task?.type ?? "task",
    provider: m.providers?.name ?? "—",
    confidence: m.quotes?.confidence ?? null,
    bond: m.bond_usdc,
    price: m.price_usdc,
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
  slashedCount: number;
  organic: number;
  demand: number;
  openCount: number;
  paidCount: number;
}

export async function getTotals(): Promise<Totals> {
  const sb = supabasePublic();
  const { data } = await sb.from("matches").select("status,price_usdc,bond_usdc,source");
  const rows = data ?? [];
  const settled = rows.filter((r) => isSettled(r.status));
  return {
    matchesSettled: settled.length,
    usdcSettled: settled.reduce((s, r) => s + Number(r.price_usdc ?? 0), 0),
    bondsAtRisk: rows.filter((r) => isAtRisk(r.status)).reduce((s, r) => s + Number(r.bond_usdc ?? 0), 0),
    slashesCompensated: rows.filter((r) => outcome(r) === "slashed").reduce((s, r) => s + Number(r.bond_usdc ?? 0), 0),
    slashedCount: rows.filter((r) => outcome(r) === "slashed").length,
    organic: settled.filter((r) => r.source !== "demand_agent").length,
    demand: settled.filter((r) => r.source === "demand_agent").length,
    openCount: rows.filter((r) => (OPEN_STAGES as readonly string[]).includes(r.status)).length,
    paidCount: rows.filter((r) => (PAID_STAGES as readonly string[]).includes(r.status)).length,
  };
}

// One real settled bond, traced through its on-chain steps — powers the landing "follow one bond"
// walkthrough. bond/verdict(validation_response)/settle/refund/slash are real tx hashes; the x402
// payment is a batched Gateway settlement (no single hash), so the landing labels that step honestly.
export interface WalkStep {
  task: string; spec: string; provider: string; price: number; bond: number; conf: number; score: number;
  bondTx: string; verdictTx: string | null; settleTx: string | null; refundTx: string | null; slashTx: string | null;
}

export async function getWalkthrough(): Promise<{ pass: WalkStep | null; slash: WalkStep | null }> {
  const sb = supabasePublic();
  const { data } = await sb
    .from("matches")
    .select("status,bond_usdc,price_usdc,bond_tx,settle_tx,validation_response_tx,refund_tx,stake_slash_tx,providers(name),quotes(task,confidence),validations(score)")
    .in("status", [...TERMINAL])
    .not("bond_tx", "is", null)
    .order("created_at", { ascending: false })
    .limit(80);
  const rows = (data ?? []) as Record<string, any>[];
  const map = (m: Record<string, any>): WalkStep => {
    const q = m.quotes ?? {}, t = q.task ?? {};
    const v = Array.isArray(m.validations) ? m.validations[0] : m.validations;
    return {
      task: t.type ?? "task", spec: t.spec ?? "", provider: m.providers?.name ?? "provider",
      price: Number(m.price_usdc ?? 0), bond: Number(m.bond_usdc ?? 0), conf: Number(q.confidence ?? 0),
      score: Number(v?.score ?? 0), bondTx: m.bond_tx,
      verdictTx: m.validation_response_tx, settleTx: m.settle_tx, refundTx: m.refund_tx, slashTx: m.stake_slash_tx,
    };
  };
  const pass = rows.find((r) => outcome(r) === "passed" && r.settle_tx && r.validation_response_tx);
  const slash = rows.find((r) => outcome(r) === "slashed" && (r.refund_tx || r.stake_slash_tx));
  return { pass: pass ? map(pass) : null, slash: slash ? map(slash) : null };
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
    .in("status", [...TERMINAL]);
  const rows = (data ?? []) as unknown as Array<{ status: string; quotes: { confidence: number | null } | null }>;
  const buckets: CalibrationBucket[] = [];
  for (let lo = 0.5; lo < 1.0 - 1e-9; lo += 0.05) {
    const hi = lo + 0.05;
    const inBucket = rows.filter((r) => {
      const c = r.quotes?.confidence;
      return c != null && c >= lo && c < (hi >= 0.999 ? 1.001 : hi);
    });
    const passes = inBucket.filter((r) => outcome(r) !== "slashed").length; // settled and not slashed = passed (either kind)
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
  agentId: number | null;
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
      agentId: p.agent_id ?? null,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
