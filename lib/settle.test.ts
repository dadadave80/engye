// The settlement engine, tested THROUGH its interface with a fake store + fake chain — no Supabase,
// no RPC, no LLM. These branches move real money in prod (release vs slash vs stake-slash vs refund,
// and the resume-after-death guards); before the MatchStore/SettleChain seams they were only ever
// exercised by live-testnet scripts.
import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { settleMatch, type SettleChain, type SettleDeps } from "./settle";
import type { FinalizeUpdate, MatchStore, SettleMatchRow, Verdict } from "./matchStore";
import { BondStatus } from "./escrow";

const KEY = ("0x" + "ab".repeat(32)) as Hex;

function row(over: Partial<SettleMatchRow> = {}): SettleMatchRow {
  return {
    id: "m1",
    match_key: KEY,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    status: "awaiting_verdict",
    bond_tx: "0xbond",
    validation_request_tx: null, // tail's ERC-8004 steps stay skipped in unit tests
    validation_response_tx: null,
    feedback_tx: null,
    deliverable: { answer: "42" },
    bond_usdc: 0.01,
    price_usdc: 0.002,
    requester_wallet: null,
    quotes: { task: { spec: "answer the question" }, total_price_usdc: 0.002, action: "accept", requester_wallet: "0x" + "11".repeat(20) },
    providers: { id: "p1", wallet_address: "0x" + "22".repeat(20), agent_id: null, price_usdc: 0.001 },
    ...over,
  };
}

/** In-memory MatchStore: one row, records every write. */
function fakeStore(r: SettleMatchRow | null, storedVerdict: Verdict | null = null) {
  const state = {
    finalized: null as FinalizeUpdate | null,
    retried: false,
    insertedVerdict: null as Verdict | null,
    computeCalls: 0,
  };
  const store: MatchStore = {
    async claimForSettlement() { return r; },
    async verdictOnce(_id, compute) {
      if (storedVerdict) return storedVerdict;
      state.computeCalls++;
      state.insertedVerdict = await compute();
      return state.insertedVerdict;
    },
    async finalizeMatch(_id, upd) { state.finalized = upd; },
    async markRetry() { state.retried = true; },
    async recordTailTx() {},
    async dueMatchIds() { return r ? [r.id] : []; },
    async tailCandidates() { return []; },
  };
  return { store, state };
}

/** Scripted SettleChain that records calls; override any op per test. */
function fakeChain(over: Partial<SettleChain> = {}) {
  const calls: string[] = [];
  const chain: SettleChain = {
    getBond: async () => { calls.push("getBond"); return { status: BondStatus.OPEN }; },
    releaseBond: async () => { calls.push("releaseBond"); return "0xrelease" as Hex; },
    slashBond: async () => { calls.push("slashBond"); return "0xslash" as Hex; },
    alreadySlashed: async () => { calls.push("alreadySlashed"); return false; },
    slashProviderStake: async () => { calls.push("slashProviderStake"); return "0xstake" as Hex; },
    alreadyRefunded: async () => { calls.push("alreadyRefunded"); return false; },
    refundFromTreasury: async () => { calls.push("refundFromTreasury"); return "0xrefund" as Hex; },
    ...over,
  };
  return { chain, calls };
}

const deps = (store: MatchStore | null, chain: SettleChain, verdict: Verdict = { pass: true, score: 90 }): SettleDeps => ({
  store,
  chain,
  validate: async () => ({ ...verdict, reasons: [], model: "fake", latencyMs: 1 }),
});

describe("settleMatch through its seams", () => {
  test("bonded PASS with an open bond → release, terminal 'delivered', settle_tx recorded", async () => {
    const { store, state } = fakeStore(row());
    const { chain, calls } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: true, score: 92 }))).toBe("settled");
    expect(calls).toEqual(["getBond", "releaseBond"]);
    expect(state.finalized?.status).toBe("delivered");
    expect(state.finalized?.settleTx).toBe("0xrelease");
    expect(state.finalized?.refundTx).toBeUndefined();
  });

  test("bonded FAIL with an open bond → slash + stake-slash + refund, terminal 'failed_compensated'", async () => {
    const { store, state } = fakeStore(row());
    const { chain, calls } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 12 }))).toBe("settled");
    expect(calls).toEqual(["getBond", "slashBond", "alreadySlashed", "slashProviderStake", "alreadyRefunded", "refundFromTreasury"]);
    expect(state.finalized?.status).toBe("failed_compensated");
    expect(state.finalized?.settleTx).toBe("0xslash");
    expect(state.finalized?.stakeSlashTx).toBe("0xstake");
    expect(state.finalized?.refundTx).toBe("0xrefund");
  });

  test("resume after mid-settle death: bond already SLASHED + stake already slashed → only the refund runs, and no already-done tx is re-recorded", async () => {
    const { store, state } = fakeStore(row());
    const { chain, calls } = fakeChain({
      getBond: async () => ({ status: BondStatus.SLASHED }),
      alreadySlashed: async () => true,
    });
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 5 }))).toBe("settled");
    expect(calls).not.toContain("slashBond");
    expect(calls).not.toContain("slashProviderStake");
    expect(state.finalized?.status).toBe("failed_compensated");
    // only the tx this attempt produced is written — the earlier attempt's hashes stay untouched
    expect(state.finalized?.settleTx).toBeUndefined();
    expect(state.finalized?.stakeSlashTx).toBeUndefined();
    expect(state.finalized?.refundTx).toBe("0xrefund");
  });

  test("unbonded (best-effort) match → zero chain calls, terminal 'delivered'", async () => {
    const { store, state } = fakeStore(row({ bond_tx: null }));
    const { chain, calls } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 10 }))).toBe("settled");
    expect(calls).toEqual([]);
    expect(state.finalized?.status).toBe("delivered");
  });

  test("a chain failure → 'retry' + settle_retry, and the match is NOT finalized", async () => {
    const { store, state } = fakeStore(row());
    const { chain } = fakeChain({ getBond: async () => { throw new Error("rpc down"); } });
    expect(await settleMatch("m1", deps(store, chain))).toBe("retry");
    expect(state.retried).toBe(true);
    expect(state.finalized).toBeNull();
  });

  test("lease not won (already terminal or another settler holds it) → 'skipped'", async () => {
    const { store } = fakeStore(null);
    const { chain, calls } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain))).toBe("skipped");
    expect(calls).toEqual([]);
  });

  test("a stored verdict is canonical — the validator is never re-run after money moved", async () => {
    const { store, state } = fakeStore(row(), { pass: true, score: 88 });
    const { chain, calls } = fakeChain();
    const d = deps(store, chain, { pass: false, score: 0 }); // fake validate would FAIL the match…
    expect(await settleMatch("m1", d)).toBe("settled");
    expect(state.computeCalls).toBe(0); // …but it is never consulted
    expect(calls).toContain("releaseBond"); // the stored PASS wins
  });

  test("no store (persistence unconfigured) → 'skipped'", async () => {
    const { chain } = fakeChain();
    expect(await settleMatch("m1", deps(null, chain))).toBe("skipped");
  });
});
