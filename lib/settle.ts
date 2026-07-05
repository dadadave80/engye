// Step-idempotent, resumable settlement (spec §3.2-3.3). Any step may already have run in a
// prior attempt that died — every step re-derives "already done?" from on-chain/DB state.
// Order: verdict(once) → money(on-chain-guarded) → terminal status → reputation tail(best-effort).
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { supabaseAdmin } from "./db";
import { validateDeliverable } from "./validator";
import { getBond, releaseBond, slashBond, slashProviderStake, refundFromTreasury } from "./escrow";
import { respondValidation, giveFeedback, contentHash } from "./erc8004";
import { applyOutcome } from "./reputation";

const LEASE_MS = 120_000; // a 'validating' row older than this is a dead attempt — reclaimable

const vaultViewAbi = parseAbi(["function refunded(bytes32 matchId) view returns (uint256)"]);
const pub = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 }),
});

async function alreadyRefunded(matchKey: Hex): Promise<boolean> {
  const v = await pub.readContract({
    address: process.env.REFUND_VAULT_ADDRESS as Address,
    abi: vaultViewAbi, functionName: "refunded", args: [matchKey],
  });
  return v > 0n;
}

/** Swallow only "already done" reverts; rethrow real failures. */
async function idempotent(label: string, fn: () => Promise<string>): Promise<string | null> {
  try { return await fn(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not open|already|reverted/i.test(msg)) { console.warn(`[settle] ${label}: treated as done (${msg.slice(0, 80)})`); return null; }
    throw e;
  }
}

/** Best-effort ERC-8004 + reputation tail. Money-free and idempotent — each step is guarded by its
 *  own tx column, so it is safe to re-run for a terminal match whose tail failed the first time.
 *  Never throws (logs and moves on); NEVER touches escrow/vault/stake, so it can't affect settlement. */
async function runReputationTail(
  m: Record<string, any>, provider: Record<string, any>, v: { pass: boolean; score: number }, matchKey: Hex, matchId: string,
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    if (m.validation_request_tx && !m.validation_response_tx) {
      const responseTx = await respondValidation({
        matchKey, score: v.score, deliverableHash: contentHash(JSON.stringify(m.deliverable ?? null)), passed: v.pass,
      });
      await supabaseAdmin.from("matches").update({ validation_response_tx: responseTx }).eq("id", matchId);
    }
    if (provider?.agent_id && !m.feedback_tx) {
      const feedbackTx = await giveFeedback({ providerAgentId: BigInt(provider.agent_id), score: v.score, passed: v.pass, matchKey });
      await supabaseAdmin.from("matches").update({ feedback_tx: feedbackTx }).eq("id", matchId);
      await applyOutcome({
        providerId: provider.id, matchId, pass: v.pass, score: v.score,
        latencyMs: Date.now() - Date.parse(m.created_at), earnedUsdc: Number(provider.price_usdc), onchainTx: feedbackTx,
      });
    }
  } catch (e) { console.warn(`[settle ${matchId}] reputation tail:`, e instanceof Error ? e.message : e); }
}

export async function settleMatch(matchId: string): Promise<"settled" | "skipped" | "retry"> {
  if (!supabaseAdmin) return "skipped";

  // single-winner LEASE (not a one-way flip): claim fresh work OR a stale dead attempt
  const staleBefore = new Date(Date.now() - LEASE_MS).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("matches")
    .update({ status: "validating", validating_at: new Date().toISOString() })
    .eq("id", matchId)
    .or(`status.in.(awaiting_verdict,settle_retry,error),and(status.eq.validating,validating_at.lt.${staleBefore})`)
    .select("*, quotes(task,total_price_usdc,action,requester_wallet), providers(id,wallet_address,agent_id,price_usdc)")
    .single();
  if (!claimed) return "skipped"; // another settler holds a fresh lease, or already terminal

  const m = claimed as Record<string, any>;
  const quote = m.quotes, provider = m.providers;
  const matchKey = m.match_key as Hex;
  const startedAt = Date.parse(m.created_at);

  try {
    // 1. VERDICT — exactly once, ever. The unique index on validations(match_id) (migration 0005)
    // is the real backstop: if a concurrent settler (a live after() racing a sweep past the lease)
    // also computes a verdict, only one INSERT wins; the loser's unique-violation is swallowed and
    // BOTH re-read the single canonical row, so the LLM verdict can never be re-derived after money
    // moves. (A bare maybeSingle() on 2 rows returns null+error and would silently re-validate forever.)
    const sel = await supabaseAdmin.from("validations").select("pass,score,reasons,model").eq("match_id", matchId).maybeSingle();
    if (sel.error) throw new Error(`validation read failed: ${sel.error.message}`);
    let v = sel.data;
    if (!v) {
      const fresh = await validateDeliverable(quote.task.spec, quote.task.quality_bar, m.deliverable, matchId);
      const ins = await supabaseAdmin.from("validations").insert({ match_id: matchId, pass: fresh.pass, score: fresh.score, reasons: fresh.reasons, model: fresh.model });
      if (ins.error && !/duplicate key|already exists|unique|23505/i.test(ins.error.message)) throw new Error(`validation persist failed: ${ins.error.message}`);
      // the unique index guarantees exactly one canonical row now exists — read it, never fall back
      // to our own `fresh` verdict (that fallback WAS the divergence path: a losing racer proceeding
      // on a different, unpersisted verdict). If the read fails, throw → settle_retry → a later sweep
      // resumes on the canonical row. No settle proceeds on an unverified verdict.
      const reread = await supabaseAdmin.from("validations").select("pass,score,reasons,model").eq("match_id", matchId).maybeSingle();
      if (reread.error || !reread.data) throw new Error(`validation reread failed: ${reread.error?.message ?? "no canonical row after insert"}`);
      v = reread.data;
    }

    // 2. MONEY — driven by on-chain state, not DB flags. Only bonded matches have on-chain steps.
    const txs: Record<string, string | null> = {};
    const bonded = !!m.bond_tx;
    if (bonded) {
      const bond = await getBond(matchKey);
      if (bond.status === 1) {
        if (v.pass) txs.settle_tx = await releaseBond(matchKey);
        else txs.slash_tx = await slashBond(matchKey);
      } // 2/3/4 → that step already happened (or timeout beat us) — continue to the still-owed steps
      if (!v.pass) {
        txs.stake_slash_tx = await idempotent("stake-slash", () =>
          slashProviderStake(matchKey, provider.wallet_address as Address, (quote.requester_wallet ?? m.requester_wallet) as Address, Number(m.bond_usdc)));
        if (!(await alreadyRefunded(matchKey))) {
          txs.refund_tx = await idempotent("vault-refund", () =>
            refundFromTreasury(matchKey, (quote.requester_wallet ?? m.requester_wallet) as Address, Number(m.price_usdc)));
        }
      }
    }

    // 3. TERMINAL STATUS — before the reputation tail, so a tail crash can't re-run money steps.
    // Write ONLY tx hashes this attempt actually produced; never fall back to our stale snapshot
    // (m.settle_tx etc.), or a redundant racer that produced no new tx would null a hash the real
    // settler just wrote. Omitted columns are left untouched.
    const status = !bonded ? "delivered" : v.pass ? "delivered" : "failed_compensated";
    const upd: Record<string, unknown> = { status, settled_at: new Date().toISOString(), latency_ms: Date.now() - startedAt };
    const settleTx = txs.settle_tx ?? txs.slash_tx;
    if (settleTx) upd.settle_tx = settleTx;
    if (txs.refund_tx) upd.refund_tx = txs.refund_tx;
    if (txs.stake_slash_tx) upd.stake_slash_tx = txs.stake_slash_tx;
    await supabaseAdmin.from("matches").update(upd).eq("id", matchId);

    // 4. REPUTATION TAIL — best-effort, money-free, idempotent. If it fails here it is retried later
    //    by retryTails() (the sweep) so a Groq/RPC hiccup can't leave a permanent hole in the graph.
    await runReputationTail(m, provider, { pass: v.pass, score: v.score }, matchKey, matchId);

    return "settled";
  } catch (e) {
    console.error(`[settle ${matchId}] failed:`, e instanceof Error ? e.message : e);
    await supabaseAdmin.from("matches").update({ status: "settle_retry" }).eq("id", matchId);
    return "retry";
  }
}

/** Sweep everything past its verdict window that isn't terminal. Permissionless via /api/settle. */
export async function sweepDueMatches(limit = 10): Promise<number> {
  if (!supabaseAdmin) return 0;
  const staleBefore = new Date(Date.now() - LEASE_MS).toISOString();
  const now = new Date().toISOString();
  // verdict_due_at gates only the window-based branches; a bonded 'error' (crash BEFORE delivery, so
  // verdict_due_at is still NULL) must be reachable — NULL < now is never true, so it can't sit under
  // a top-level .lt() or it would be silently excluded from remediation.
  const { data: due } = await supabaseAdmin
    .from("matches").select("id")
    .or(`and(verdict_due_at.lt.${now},status.in.(awaiting_verdict,settle_retry)),and(verdict_due_at.lt.${now},status.eq.validating,validating_at.lt.${staleBefore}),and(status.eq.error,bond_tx.not.is.null)`)
    // order by created_at (always non-null) not verdict_due_at — error-branch rows have a NULL
    // verdict_due_at and would sort NULLS LAST, starving them behind a window-based backlog under limit().
    .order("created_at", { ascending: true }).limit(limit);
  let done = 0;
  for (const row of due ?? []) if ((await settleMatch(row.id)) === "settled") done++;
  return done;
}

/** Re-run the money-free reputation tail for TERMINAL matches whose ERC-8004 validation response
 *  never posted (a Groq/RPC hiccup after settlement) — keeps the on-chain reputation graph complete.
 *  Guarded to matches that filed a validation request but have no response tx; runReputationTail also
 *  completes any missing feedback for those. Money is already settled and never touched here. */
export async function retryTails(limit = 10): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { data: rows } = await supabaseAdmin
    .from("matches")
    .select("id,match_key,created_at,deliverable,validation_request_tx,validation_response_tx,feedback_tx,providers(id,agent_id,price_usdc),validations(pass,score)")
    .in("status", ["delivered", "failed_compensated"])
    .not("validation_request_tx", "is", null)
    .is("validation_response_tx", null)
    .order("settled_at", { ascending: true }).limit(limit);
  let done = 0;
  for (const row of rows ?? []) {
    const m = row as Record<string, any>;
    const v = m.validations?.[0];
    if (!v) continue; // no stored verdict → nothing to post
    await runReputationTail(m, m.providers, { pass: v.pass, score: v.score }, m.match_key as Hex, m.id);
    done++;
  }
  return done;
}
