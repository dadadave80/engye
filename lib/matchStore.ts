// The settlement engine's persistence seam. This module owns everything Supabase-shaped about
// settling a match — the join strings, the lease claim's .or() filter, and the verdict's
// insert-then-reread idempotency — behind named methods returning TYPED rows. settle.ts depends on
// the MatchStore interface, so a fake store drives the state machine in-memory in tests.
import type { Hex } from "viem";
import { supabaseAdmin } from "./db";
import { CLAIMABLE, TERMINAL, legalFroms, type MatchStatus, type TerminalStatus } from "./matchLifecycle";

export interface SettleQuoteJoin {
  task: { spec: string; quality_bar?: string };
  total_price_usdc: number | string;
  action: string;
  requester_wallet: string | null;
}

export interface SettleProviderJoin {
  id: string;
  wallet_address: string;
  agent_id: string | number | null;
  price_usdc: number | string;
}

/** The match row as the settlement engine sees it (base columns + the two joins). */
export interface SettleMatchRow {
  id: string;
  match_key: Hex;
  created_at: string;
  status: MatchStatus;
  bond_tx: string | null;
  validation_request_tx: string | null;
  validation_response_tx: string | null;
  feedback_tx: string | null;
  deliverable: unknown;
  bond_usdc: number | string | null;
  price_usdc: number | string | null;
  requester_wallet: string | null;
  quotes: SettleQuoteJoin;
  providers: SettleProviderJoin | null;
}

export interface Verdict {
  pass: boolean;
  score: number;
  reasons?: unknown;
  model?: string | null;
}

/** Terminal-status write: only tx hashes THIS attempt produced — omitted columns stay untouched. */
export interface FinalizeUpdate {
  status: TerminalStatus;
  latencyMs: number;
  settleTx?: string;
  refundTx?: string;
  stakeSlashTx?: string;
}

/** retryTails' candidate shape: a terminal match whose ERC-8004 response never posted. */
export interface TailRow {
  id: string;
  match_key: Hex;
  created_at: string;
  deliverable: unknown;
  validation_request_tx: string | null;
  validation_response_tx: string | null;
  feedback_tx: string | null;
  providers: SettleProviderJoin | null;
  verdict: Verdict | null;
}

export interface MatchStore {
  /** Single-winner lease: claim fresh due work OR a stale dead 'validating' attempt; null = skip. */
  claimForSettlement(matchId: string, leaseMs: number): Promise<SettleMatchRow | null>;
  /** Exactly-once verdict: read the canonical row, else compute+insert (unique-violation-safe) and
   *  REREAD — never proceeds on an unpersisted verdict. */
  verdictOnce(matchId: string, compute: () => Promise<Verdict>): Promise<Verdict>;
  finalizeMatch(matchId: string, upd: FinalizeUpdate): Promise<void>;
  markRetry(matchId: string): Promise<void>;
  recordTailTx(matchId: string, col: "validation_response_tx" | "feedback_tx", tx: string): Promise<void>;
  /** The sweep filter: everything past its verdict window that isn't terminal (incl. bonded errors). */
  dueMatchIds(limit: number, leaseMs: number): Promise<string[]>;
  tailCandidates(limit: number): Promise<TailRow[]>;
}

/** The execute route's forward-path writes — the other half of the lifecycle, same bouncer. */
export interface InsertMatchRow {
  quote_id: string;
  provider_id: string;
  match_key: Hex;
  decision_json: unknown;
  bond_usdc: number | string | null;
  price_usdc: number | string | null;
  source: string;
}

export interface MatchForward {
  /** Creates the match at 'pending'. */
  insertMatch(row: InsertMatchRow): Promise<{ id: string }>;
  markBonded(id: string, tx: { bondTx: string; validationRequestTx?: string | null }): Promise<void>;
  markPaid(id: string, upd: { payTx: string; deliverable: unknown }): Promise<void>;
  markAwaitingVerdict(id: string, upd: { verdictDueAt: string; requesterWallet: string }): Promise<void>;
  /** Best-effort from the route's catch — guarded so it can never resurrect a terminal match. */
  markError(id: string): Promise<void>;
}

export function supabaseMatchForward(): MatchForward | null {
  const sb = supabaseAdmin;
  if (!sb) return null;
  // the bouncer: UPDATE … WHERE status IN legalFroms(to). These marks run AFTER money has moved
  // (bond posted / provider paid), so they must never abort the lifecycle: an illegal jump is
  // REFUSED at the DB and logged; a transient write error is retried once then logged. Aborting
  // here was review-proven money-destroying (a DB blip flipped a delivered match into 'error' →
  // the sweep validated a NULL deliverable → slash). Recovery (sweep + claim_timeout) owns the rest.
  const guarded = async (id: string, to: MatchStatus, patch: Record<string, unknown>) => {
    const write = () => sb.from("matches").update({ status: to, ...patch }).eq("id", id)
      .in("status", legalFroms(to)).select("id");
    let { data, error } = await write();
    if (error) ({ data, error } = await write()); // one immediate retry kills most transients
    if (error) console.error(`[matchStore] match ${id} → ${to} write failed (continuing best-effort): ${error.message}`);
    else if (!data?.length) console.error(`[matchStore] REFUSED illegal transition: match ${id} not in [${legalFroms(to).join("|")}] → ${to}`);
  };
  return {
    async insertMatch(row) {
      const { data, error } = await sb.from("matches").insert({ ...row, status: "pending" satisfies MatchStatus }).select("id").single();
      if (error || !data) throw new Error(`match insert failed: ${error?.message ?? "no row returned"}`);
      return { id: data.id };
    },
    markBonded: (id, t) => guarded(id, "bonded", { bond_tx: t.bondTx, validation_request_tx: t.validationRequestTx ?? null }),
    markPaid: (id, u) => guarded(id, "paid", { pay_tx: u.payTx, deliverable: u.deliverable }),
    markAwaitingVerdict: (id, u) => guarded(id, "awaiting_verdict", { verdict_due_at: u.verdictDueAt, requester_wallet: u.requesterWallet }),
    async markError(id) {
      // quiet 0-rows: erroring is the catch path — refusing to resurrect a terminal match matters;
      // throwing inside the route's error handler doesn't.
      await sb.from("matches").update({ status: "error" satisfies MatchStatus }).eq("id", id).in("status", legalFroms("error"));
    },
  };
}

const SETTLE_JOIN = "*, quotes(task,total_price_usdc,action,requester_wallet), providers(id,wallet_address,agent_id,price_usdc)";

/** The real store over supabaseAdmin; null when persistence isn't configured. */
export function supabaseMatchStore(): MatchStore | null {
  const sb = supabaseAdmin;
  if (!sb) return null;
  return {
    async claimForSettlement(matchId, leaseMs) {
      const staleBefore = new Date(Date.now() - leaseMs).toISOString();
      const { data } = await sb
        .from("matches")
        .update({ status: "validating", validating_at: new Date().toISOString() })
        .eq("id", matchId)
        .or(`status.in.(${CLAIMABLE.join(",")}),and(status.eq.validating,validating_at.lt.${staleBefore})`)
        .select(SETTLE_JOIN)
        .single();
      return (data as unknown as SettleMatchRow) ?? null;
    },

    async verdictOnce(matchId, compute) {
      const sel = await sb.from("validations").select("pass,score,reasons,model").eq("match_id", matchId).maybeSingle();
      if (sel.error) throw new Error(`validation read failed: ${sel.error.message}`);
      if (sel.data) return sel.data as Verdict;
      const fresh = await compute();
      // the unique index on validations(match_id) (migration 0005) is the real backstop: if a
      // concurrent settler also computed, only one INSERT wins — swallow the loser's violation…
      const ins = await sb.from("validations").insert({ match_id: matchId, pass: fresh.pass, score: fresh.score, reasons: fresh.reasons, model: fresh.model });
      if (ins.error && !/duplicate key|already exists|unique|23505/i.test(ins.error.message)) throw new Error(`validation persist failed: ${ins.error.message}`);
      // …then BOTH racers reread the single canonical row. Never fall back to our own `fresh` —
      // that fallback WAS the divergence path (a loser proceeding on an unpersisted verdict).
      const reread = await sb.from("validations").select("pass,score,reasons,model").eq("match_id", matchId).maybeSingle();
      if (reread.error || !reread.data) throw new Error(`validation reread failed: ${reread.error?.message ?? "no canonical row after insert"}`);
      return reread.data as Verdict;
    },

    async finalizeMatch(matchId, upd) {
      const hashes: Record<string, unknown> = {};
      if (upd.settleTx) hashes.settle_tx = upd.settleTx;
      if (upd.refundTx) hashes.refund_tx = upd.refundTx;
      if (upd.stakeSlashTx) hashes.stake_slash_tx = upd.stakeSlashTx;
      const row = { status: upd.status, settled_at: new Date().toISOString(), latency_ms: upd.latencyMs, ...hashes };
      const { data, error } = await sb.from("matches").update(row).eq("id", matchId)
        .in("status", legalFroms(upd.status)).select("id");
      // an error is NOT "a racer finalized first" — throw so the settle engine's retry loop re-runs
      if (error) throw new Error(`finalize write failed: ${error.message}`);
      if (!data?.length && Object.keys(hashes).length) {
        // a racer finalized first (same canonical verdict → same status). Never lose an on-chain
        // fact this attempt produced: patch the tx hashes WITHOUT touching the terminal status.
        const patch = await sb.from("matches").update(hashes).eq("id", matchId);
        if (patch.error) throw new Error(`finalize hash-patch failed: ${patch.error.message}`);
      }
    },

    async markRetry(matchId) {
      await sb.from("matches").update({ status: "settle_retry" }).eq("id", matchId).eq("status", "validating");
    },

    async recordTailTx(matchId, col, tx) {
      await sb.from("matches").update({ [col]: tx }).eq("id", matchId);
    },

    async dueMatchIds(limit, leaseMs) {
      const staleBefore = new Date(Date.now() - leaseMs).toISOString();
      const now = new Date().toISOString();
      // verdict_due_at gates only the window-based branches; a bonded 'error' (crash BEFORE
      // delivery → verdict_due_at NULL) must stay reachable, so it can't sit under a top-level
      // .lt(). Order by created_at (never NULL) so error rows aren't starved under limit().
      const { data } = await sb
        .from("matches").select("id")
        .or([
          `and(verdict_due_at.lt.${now},status.in.(awaiting_verdict,settle_retry))`,
          `and(verdict_due_at.lt.${now},status.eq.validating,validating_at.lt.${staleBefore})`,
          `and(status.eq.error,bond_tx.not.is.null)`,
          // error-remediation rows carry a NULL verdict_due_at (crash before delivery) — after one
          // failed remediation attempt they sit at settle_retry / stale-validating and must remain
          // sweepable, or the requester's refund never fires (review finding, pre-existing).
          `and(verdict_due_at.is.null,bond_tx.not.is.null,status.eq.settle_retry)`,
          `and(verdict_due_at.is.null,bond_tx.not.is.null,status.eq.validating,validating_at.lt.${staleBefore})`,
        ].join(","))
        .order("created_at", { ascending: true }).limit(limit);
      return (data ?? []).map((r: { id: string }) => r.id);
    },

    async tailCandidates(limit) {
      const { data } = await sb
        .from("matches")
        .select("id,match_key,created_at,deliverable,validation_request_tx,validation_response_tx,feedback_tx,providers(id,wallet_address,agent_id,price_usdc),validations(pass,score)")
        .in("status", [...TERMINAL])
        .not("validation_request_tx", "is", null)
        .is("validation_response_tx", null)
        .order("settled_at", { ascending: true }).limit(limit);
      return (data ?? []).map((r) => {
        const m = r as unknown as TailRow & { validations?: Verdict[] };
        return { ...m, verdict: m.validations?.[0] ?? null };
      });
    },
  };
}
