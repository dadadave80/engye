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
    // 1. VERDICT — once. Re-runs reuse the stored row; the LLM is never re-asked after money moved.
    let { data: v } = await supabaseAdmin.from("validations").select("pass,score,reasons,model").eq("match_id", matchId).maybeSingle();
    if (!v) {
      const fresh = await validateDeliverable(quote.task.spec, quote.task.quality_bar, m.deliverable, matchId);
      await supabaseAdmin.from("validations").insert({ match_id: matchId, pass: fresh.pass, score: fresh.score, reasons: fresh.reasons, model: fresh.model });
      v = { pass: fresh.pass, score: fresh.score, reasons: fresh.reasons, model: fresh.model };
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
    const status = !bonded ? "delivered" : v.pass ? "delivered" : "failed_compensated";
    await supabaseAdmin.from("matches").update({
      status, settled_at: new Date().toISOString(), latency_ms: Date.now() - startedAt,
      settle_tx: txs.settle_tx ?? txs.slash_tx ?? m.settle_tx, refund_tx: txs.refund_tx ?? m.refund_tx,
      stake_slash_tx: txs.stake_slash_tx ?? m.stake_slash_tx,
    }).eq("id", matchId);

    // 4. REPUTATION TAIL — best-effort; failures logged, never fatal, not retried against money.
    try {
      if (m.validation_request_tx && !m.validation_response_tx) {
        const responseTx = await respondValidation({
          matchKey, score: v.score, deliverableHash: contentHash(JSON.stringify(m.deliverable ?? null)), passed: v.pass,
        });
        await supabaseAdmin.from("matches").update({ validation_response_tx: responseTx }).eq("id", matchId);
      }
      if (provider.agent_id && !m.feedback_tx) {
        const feedbackTx = await giveFeedback({ providerAgentId: BigInt(provider.agent_id), score: v.score, passed: v.pass, matchKey });
        await supabaseAdmin.from("matches").update({ feedback_tx: feedbackTx }).eq("id", matchId);
        await applyOutcome({
          providerId: provider.id, matchId, pass: v.pass, score: v.score,
          latencyMs: Date.now() - startedAt, earnedUsdc: Number(provider.price_usdc), onchainTx: feedbackTx,
        });
      }
    } catch (e) { console.warn(`[settle ${matchId}] reputation tail:`, e instanceof Error ? e.message : e); }

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
  const { data: due } = await supabaseAdmin
    .from("matches").select("id")
    .lt("verdict_due_at", new Date().toISOString())
    .or(`status.in.(awaiting_verdict,settle_retry),and(status.eq.validating,validating_at.lt.${staleBefore}),and(status.eq.error,bond_tx.not.is.null)`)
    .order("verdict_due_at", { ascending: true }).limit(limit);
  let done = 0;
  for (const row of due ?? []) if ((await settleMatch(row.id)) === "settled") done++;
  return done;
}
