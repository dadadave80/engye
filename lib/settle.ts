// Step-idempotent, resumable settlement (spec §3.2-3.3). Any step may already have run in a
// prior attempt that died — every step re-derives "already done?" from on-chain/DB state.
// Order: verdict(once) → money(on-chain-guarded) → terminal status → reputation tail(best-effort).
// Persistence goes through the MatchStore seam (lib/matchStore.ts) and chain effects through the
// SettleChain seam, both injectable — settleMatch is unit-testable with fakes and runs live with
// the defaults.
import { parseAbi, type Address, type Hex } from "viem";
import { arcPublic } from "./chain";
import { validateDeliverable } from "./validator";
import { BondStatus, getBond, releaseBond, slashBond, slashProviderStake, refundFromTreasury } from "./escrow";
import { respondValidation, giveFeedback, contentHash } from "./erc8004";
import { applyOutcome } from "./reputation";
import { supabaseMatchStore, type MatchStore, type SettleMatchRow, type SettleProviderJoin, type Verdict } from "./matchStore";

const LEASE_MS = 120_000; // a 'validating' row older than this is a dead attempt — reclaimable

const vaultViewAbi = parseAbi(["function refunded(bytes32 matchId) view returns (uint256)"]);
const stakeViewAbi = parseAbi(["function slashed_for(bytes32 matchId) view returns (uint256)"]);

async function alreadyRefunded(matchKey: Hex): Promise<boolean> {
  const v = await arcPublic().readContract({
    address: process.env.REFUND_VAULT_ADDRESS as Address,
    abi: vaultViewAbi, functionName: "refunded", args: [matchKey],
  });
  return v > 0n;
}

async function alreadySlashed(matchKey: Hex): Promise<boolean> {
  const v = await arcPublic().readContract({
    address: process.env.PROVIDER_STAKE_ADDRESS as Address,
    abi: stakeViewAbi, functionName: "slashed_for", args: [matchKey],
  });
  return v > 0n;
}

/** Every on-chain effect settlement can take — the seam a test fakes. */
export interface SettleChain {
  getBond(matchKey: Hex): Promise<{ status: number }>;
  releaseBond(matchKey: Hex): Promise<Hex>;
  slashBond(matchKey: Hex): Promise<Hex>;
  alreadySlashed(matchKey: Hex): Promise<boolean>;
  slashProviderStake(matchKey: Hex, provider: Address, requester: Address, amountUsdc: number): Promise<Hex>;
  alreadyRefunded(matchKey: Hex): Promise<boolean>;
  refundFromTreasury(matchKey: Hex, to: Address, amountUsdc: number): Promise<Hex>;
}

export interface SettleDeps {
  store: MatchStore | null;
  chain: SettleChain;
  validate: typeof validateDeliverable;
}

const realChain: SettleChain = { getBond, releaseBond, slashBond, alreadySlashed, slashProviderStake, alreadyRefunded, refundFromTreasury };
const realDeps = (): SettleDeps => ({ store: supabaseMatchStore(), chain: realChain, validate: validateDeliverable });

/** Best-effort ERC-8004 + reputation tail. Money-free and idempotent — each step is guarded by its
 *  own tx column, so it is safe to re-run for a terminal match whose tail failed the first time.
 *  Never throws (logs and moves on); NEVER touches escrow/vault/stake, so it can't affect settlement. */
async function runReputationTail(
  store: MatchStore,
  m: Pick<SettleMatchRow, "created_at" | "deliverable" | "validation_request_tx" | "validation_response_tx" | "feedback_tx">,
  provider: SettleProviderJoin | null,
  v: { pass: boolean; score: number },
  matchKey: Hex,
  matchId: string,
): Promise<void> {
  try {
    if (m.validation_request_tx && !m.validation_response_tx) {
      const responseTx = await respondValidation({
        matchKey, score: v.score, deliverableHash: contentHash(JSON.stringify(m.deliverable ?? null)), passed: v.pass,
      });
      await store.recordTailTx(matchId, "validation_response_tx", responseTx);
    }
    if (provider?.agent_id && !m.feedback_tx) {
      const feedbackTx = await giveFeedback({ providerAgentId: BigInt(provider.agent_id), score: v.score, passed: v.pass, matchKey });
      await store.recordTailTx(matchId, "feedback_tx", feedbackTx);
      await applyOutcome({
        providerId: provider.id, matchId, pass: v.pass, score: v.score,
        latencyMs: Date.now() - Date.parse(m.created_at), earnedUsdc: Number(provider.price_usdc), onchainTx: feedbackTx,
      });
    }
  } catch (e) { console.warn(`[settle ${matchId}] reputation tail:`, e instanceof Error ? e.message : e); }
}

export async function settleMatch(matchId: string, deps: SettleDeps = realDeps()): Promise<"settled" | "skipped" | "retry"> {
  const { store, chain } = deps;
  if (!store) return "skipped";

  // single-winner LEASE (not a one-way flip): claim fresh work OR a stale dead attempt
  const m = await store.claimForSettlement(matchId, LEASE_MS);
  if (!m) return "skipped"; // another settler holds a fresh lease, or already terminal

  const quote = m.quotes, provider = m.providers;
  const matchKey = m.match_key;
  const startedAt = Date.parse(m.created_at);

  try {
    // 1. VERDICT — exactly once, ever (idempotency lives in the store's verdictOnce; the unique
    // index on validations(match_id) is the backstop under racers).
    const v: Verdict = await store.verdictOnce(matchId, () =>
      deps.validate(quote.task.spec, quote.task.quality_bar, m.deliverable, matchId));

    // 2. MONEY — driven by on-chain state, not DB flags. Only bonded matches have on-chain steps.
    const txs: Record<string, string | null> = {};
    const bonded = !!m.bond_tx;
    if (bonded) {
      const bond = await chain.getBond(matchKey);
      if (bond.status === BondStatus.OPEN) {
        if (v.pass) txs.settle_tx = await chain.releaseBond(matchKey);
        else txs.slash_tx = await chain.slashBond(matchKey);
      } // RELEASED/SLASHED/TIMEOUT_CLAIMED → that step already happened — continue to the still-owed steps
      if (!v.pass) {
        const requester = (quote.requester_wallet ?? m.requester_wallet) as Address;
        // On-chain state, not string-matching, decides "already done" — immune to revert-message
        // drift and can't misclassify a genuine failure (exhausted vault float, misconfig, transient
        // RPC error) as done. A real failure now throws → outer catch → settle_retry → sweep retries.
        if (!(await chain.alreadySlashed(matchKey))) {
          txs.stake_slash_tx = await chain.slashProviderStake(matchKey, provider!.wallet_address as Address, requester, Number(m.bond_usdc));
        }
        if (!(await chain.alreadyRefunded(matchKey))) {
          txs.refund_tx = await chain.refundFromTreasury(matchKey, requester, Number(m.price_usdc));
        }
      }
    }

    // 3. TERMINAL STATUS — before the reputation tail, so a tail crash can't re-run money steps.
    // finalizeMatch writes ONLY tx hashes this attempt actually produced; omitted columns are left
    // untouched (a redundant racer must never null a hash the real settler just wrote).
    const settleTx = txs.settle_tx ?? txs.slash_tx;
    await store.finalizeMatch(matchId, {
      status: !bonded ? "delivered" : v.pass ? "delivered" : "failed_compensated",
      latencyMs: Date.now() - startedAt,
      settleTx: settleTx ?? undefined,
      refundTx: txs.refund_tx ?? undefined,
      stakeSlashTx: txs.stake_slash_tx ?? undefined,
    });

    // 4. REPUTATION TAIL — best-effort, money-free, idempotent. If it fails here it is retried later
    //    by retryTails() (the sweep) so a Groq/RPC hiccup can't leave a permanent hole in the graph.
    await runReputationTail(store, m, provider, { pass: v.pass, score: v.score }, matchKey, matchId);

    return "settled";
  } catch (e) {
    console.error(`[settle ${matchId}] failed:`, e instanceof Error ? e.message : e);
    await store.markRetry(matchId);
    return "retry";
  }
}

/** Sweep everything past its verdict window that isn't terminal. Permissionless via /api/settle. */
export async function sweepDueMatches(limit = 10, deps: SettleDeps = realDeps()): Promise<number> {
  if (!deps.store) return 0;
  const due = await deps.store.dueMatchIds(limit, LEASE_MS);
  let done = 0;
  for (const id of due) if ((await settleMatch(id, deps)) === "settled") done++;
  return done;
}

/** Re-run the money-free reputation tail for TERMINAL matches whose ERC-8004 validation response
 *  never posted (a Groq/RPC hiccup after settlement) — keeps the on-chain reputation graph complete.
 *  Money is already settled and never touched here. */
export async function retryTails(limit = 10, deps: SettleDeps = realDeps()): Promise<number> {
  if (!deps.store) return 0;
  const rows = await deps.store.tailCandidates(limit);
  let done = 0;
  for (const m of rows) {
    if (!m.verdict) continue; // no stored verdict → nothing to post
    await runReputationTail(deps.store, m, m.providers, { pass: m.verdict.pass, score: m.verdict.score }, m.match_key, m.id);
    done++;
  }
  return done;
}
