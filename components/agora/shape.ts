// Shared row-shaping for /agora. The server page (initial fetch) and the client Floor (realtime
// re-hydrate) both map the same joined `matches` row into these view models — keep the mapping in
// ONE place so the two paths can't silently diverge as the schema evolves.

export interface LiveMatch {
  id: string;
  match_key: string;
  status: string; // awaiting_verdict | validating | settle_retry
  verdict_due_at: string | null;
  price_usdc: number | null;
  bond_usdc: number | null;
  deliverable: unknown;
  task: string;
  provider: string;
  confidence: number | null;
}

export interface VerdictRow {
  id: string;
  match_key: string;
  status: "PASS" | "SLASHED";
  tx: string | null;
  at: string;
  task: string;
  provider: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function shapeLive(d: Record<string, any>): LiveMatch {
  return {
    id: d.id, match_key: d.match_key, status: d.status, verdict_due_at: d.verdict_due_at,
    price_usdc: d.price_usdc, bond_usdc: d.bond_usdc, deliverable: d.deliverable,
    task: d.quotes?.task?.type ?? "task", provider: d.providers?.name ?? "—",
    confidence: d.quotes?.confidence ?? null,
  };
}

export function shapeVerdict(d: Record<string, any>): VerdictRow | null {
  const status: "PASS" | "SLASHED" | null =
    d.status === "delivered" ? "PASS" : d.status === "failed_compensated" ? "SLASHED" : null;
  if (!status) return null;
  return {
    id: d.id, match_key: d.match_key, status, tx: d.settle_tx ?? d.bond_tx ?? null,
    at: d.settled_at ?? d.created_at, task: d.quotes?.task?.type ?? "task", provider: d.providers?.name ?? "—",
  };
}
