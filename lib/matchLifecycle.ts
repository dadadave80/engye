// The match lifecycle rulebook — THE one module that owns the stage vocabulary and the legal
// transitions of a match (quote→bond→deliver→verdict→settle). Pure and dependency-free (client-safe).
// Every status string, transition guard, and "how did this match end?" question answers from here;
// no other file spells a match status by hand. Writes are enforced by lib/matchStore.ts, whose
// guarded methods compare-and-set against legalFroms() (the bouncer to this rulebook).

export const MATCH_STATUSES = [
  "pending", // match row created; nothing on-chain yet
  "bonded", // broker bond posted (bonded path only — unbonded matches skip this)
  "paid", // provider paid over x402; deliverable stored
  "awaiting_verdict", // delivered; public verdict window running
  "validating", // a settler holds the lease (re-entrant: stale leases are reclaimed)
  "settle_retry", // a settle attempt failed recoverably; the sweep will retry
  "error", // the execute route died mid-lifecycle; bonded errors are remediated by the sweep
  "delivered", // TERMINAL — bonded: verdict passed, bond released · unbonded: handed over
  "failed_compensated", // TERMINAL — verdict failed: bond + stake slashed to requester, price refunded
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** The legal-transition table. An edge absent here does not happen — matchStore's guarded writes
 *  refuse it at the database (UPDATE … WHERE status IN legalFroms). */
export const TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  pending: ["bonded", "paid", "error"], // → paid directly on the unbonded path
  bonded: ["paid", "error"],
  paid: ["awaiting_verdict", "error"],
  awaiting_verdict: ["validating", "error"],
  validating: ["delivered", "failed_compensated", "settle_retry", "validating"], // self-edge = stale-lease reclaim
  settle_retry: ["validating"],
  error: ["validating"], // the sweep claims bonded errors for remediation
  delivered: [], // terminal
  failed_compensated: [], // terminal
};

export const TERMINAL = ["delivered", "failed_compensated"] as const satisfies readonly MatchStatus[];
export type TerminalStatus = (typeof TERMINAL)[number];
/** The agora's live set: matches currently inside (or retrying past) their verdict window. */
export const IN_VERDICT_WINDOW = ["awaiting_verdict", "validating", "settle_retry"] as const satisfies readonly MatchStatus[];
/** What the settle sweep may claim outright (a stale 'validating' lease is claimable separately). */
export const CLAIMABLE = ["awaiting_verdict", "settle_retry", "error"] as const satisfies readonly MatchStatus[];

export const canTransition = (from: MatchStatus, to: MatchStatus): boolean => TRANSITIONS[from].includes(to);

/** Every status that may legally precede `to` — the WHERE clause of a guarded write. */
export const legalFroms = (to: MatchStatus): MatchStatus[] =>
  MATCH_STATUSES.filter((from) => TRANSITIONS[from].includes(to));

export const isTerminal = (s: string): boolean => (TERMINAL as readonly string[]).includes(s);
/** Settled = reached a terminal status (the dashboard's "settled" and reputation's trial set). */
export const isSettled = isTerminal;
/** Dashboard semantics: bonds counted at risk while the broker's money is out but unsettled. */
export const isAtRisk = (s: string): boolean => s === "bonded" || s === "paid";

/** How a match ended (or hasn't) — the ONE place that knows the DB word "delivered" means both a
 *  bonded verdict-pass and an unbonded best-effort handover (disambiguated by bond_tx). */
export type MatchOutcome = "passed" | "best_effort" | "slashed" | "errored" | "in_flight";
/** Accepts loosely-typed rows (Supabase joins arrive as Record<string, any>) — this IS the one
 *  function allowed to interpret raw row shape. */
export function outcome(m: { status?: string | null; bond_tx?: string | null }): MatchOutcome {
  if (m.status === "delivered") return m.bond_tx ? "passed" : "best_effort";
  if (m.status === "failed_compensated") return "slashed";
  if (m.status === "error") return "errored";
  return "in_flight";
}

/** The quote's own little machine (the execute route's atomic claim guards it compare-and-set). */
export type QuoteStatus = "open" | "executing" | "executed" | "declined";

/** The execute API's response vocabulary — an EXTERNAL contract (the demand agent and HireChat read
 *  these off the wire), deliberately distinct from MatchStatus. NB "delivered" here (unbonded
 *  handover) collides with the DB terminal of the same name; typed so the collision is at least named. */
export type ResponseStatus = "delivered_awaiting_verdict" | "delivered";
