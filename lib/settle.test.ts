// The settlement engine, tested THROUGH its interfaces with fake store + chain + tail — no Supabase,
// no RPC, no LLM. These branches move real money in prod (release vs slash vs stake-slash vs refund,
// and the resume-after-death guards); before the MatchStore/SettleChain/SettleTail seams they were
// only ever exercised by live-testnet scripts. Fakes record {fn, args} — recipients and amounts are
// pinned, not just call order (a swapped requester/provider must fail here, not no-op on Arc).
import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { settleMatch, type SettleChain, type SettleDeps, type SettleTail } from "./settle";
import type { FinalizeUpdate, MatchStore, SettleMatchRow, Verdict } from "./matchStore";
import { BondStatus } from "./escrow";

const KEY = ("0x" + "ab".repeat(32)) as Hex;
const REQUESTER = "0x" + "11".repeat(20);
const PROVIDER_WALLET = "0x" + "22".repeat(20);

function row(over: Partial<SettleMatchRow> = {}): SettleMatchRow {
  return {
    id: "m1",
    match_key: KEY,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    status: "awaiting_verdict",
    bond_tx: "0xbond",
    validation_request_tx: null,
    validation_response_tx: null,
    feedback_tx: null,
    deliverable: { answer: "42" },
    bond_usdc: 0.01,
    price_usdc: 0.002,
    requester_wallet: null,
    quotes: { task: { spec: "answer the question" }, total_price_usdc: 0.002, action: "accept", requester_wallet: REQUESTER },
    providers: { id: "p1", wallet_address: PROVIDER_WALLET, agent_id: null, price_usdc: 0.001 },
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
    tailTxs: [] as { col: string; tx: string }[],
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
    async recordTailTx(_id, col, tx) { state.tailTxs.push({ col, tx }); },
    async dueMatchIds() { return r ? [r.id] : []; },
    async tailCandidates() { return []; },
  };
  return { store, state };
}

type Call = { fn: string; args: unknown[] };

/** Scripted SettleChain recording {fn, args}; override any op per test. */
function fakeChain(over: Partial<SettleChain> = {}) {
  const calls: Call[] = [];
  const names = () => calls.map((c) => c.fn);
  const chain: SettleChain = {
    getBond: async (...a) => { calls.push({ fn: "getBond", args: a }); return { status: BondStatus.OPEN }; },
    releaseBond: async (...a) => { calls.push({ fn: "releaseBond", args: a }); return "0xrelease" as Hex; },
    slashBond: async (...a) => { calls.push({ fn: "slashBond", args: a }); return "0xslash" as Hex; },
    alreadySlashed: async (...a) => { calls.push({ fn: "alreadySlashed", args: a }); return false; },
    slashProviderStake: async (...a) => { calls.push({ fn: "slashProviderStake", args: a }); return "0xstake" as Hex; },
    alreadyRefunded: async (...a) => { calls.push({ fn: "alreadyRefunded", args: a }); return false; },
    refundFromTreasury: async (...a) => { calls.push({ fn: "refundFromTreasury", args: a }); return "0xrefund" as Hex; },
    ...over,
  };
  return { chain, calls, names };
}

/** Recording SettleTail — the real one signs ERC-8004 txs; tests must never reach it. */
function fakeTail() {
  const calls: Call[] = [];
  const tail: SettleTail = {
    respondValidation: (async (opts: unknown) => { calls.push({ fn: "respondValidation", args: [opts] }); return "0xrespond" as Hex; }) as SettleTail["respondValidation"],
    giveFeedback: (async (opts: unknown) => { calls.push({ fn: "giveFeedback", args: [opts] }); return "0xfeedback" as Hex; }) as SettleTail["giveFeedback"],
    applyOutcome: (async (opts: unknown) => { calls.push({ fn: "applyOutcome", args: [opts] }); }) as SettleTail["applyOutcome"],
  };
  return { tail, calls };
}

function deps(store: MatchStore | null, chain: SettleChain, verdict: Verdict = { pass: true, score: 90 }, tail: SettleTail = fakeTail().tail): SettleDeps {
  return {
    store,
    chain,
    validate: async () => ({ ...verdict, reasons: [], model: "fake", latencyMs: 1 }),
    tail,
  };
}

describe("settleMatch through its seams", () => {
  test("bonded PASS with an open bond → release of THIS matchKey, terminal 'delivered', settle_tx recorded", async () => {
    const { store, state } = fakeStore(row());
    const { chain, calls, names } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: true, score: 92 }))).toBe("settled");
    expect(names()).toEqual(["getBond", "releaseBond"]);
    expect(calls[1].args).toEqual([KEY]);
    expect(state.finalized?.status).toBe("delivered");
    expect(state.finalized?.settleTx).toBe("0xrelease");
    expect(state.finalized?.refundTx).toBeUndefined();
  });

  test("bonded FAIL with an open bond → slash + stake-slash + refund, with recipients and amounts pinned", async () => {
    const { store, state } = fakeStore(row());
    const { chain, calls, names } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 12 }))).toBe("settled");
    expect(names()).toEqual(["getBond", "slashBond", "alreadySlashed", "slashProviderStake", "alreadyRefunded", "refundFromTreasury"]);
    // stake slash: (matchKey, PROVIDER loses stake, REQUESTER receives, bond-sized) — arg order is the bug class
    expect(calls[3].args).toEqual([KEY, PROVIDER_WALLET, REQUESTER, 0.01]);
    // refund: (matchKey, REQUESTER receives, PRICE not bond)
    expect(calls[5].args).toEqual([KEY, REQUESTER, 0.002]);
    expect(state.finalized?.status).toBe("failed_compensated");
    expect(state.finalized?.settleTx).toBe("0xslash");
    expect(state.finalized?.stakeSlashTx).toBe("0xstake");
    expect(state.finalized?.refundTx).toBe("0xrefund");
  });

  test("resume after mid-settle death: bond SLASHED + stake already slashed → only the refund runs, no stale hash re-recorded", async () => {
    const { store, state } = fakeStore(row());
    const { chain, names } = fakeChain({
      getBond: async () => ({ status: BondStatus.SLASHED }),
      alreadySlashed: async () => true,
    });
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 5 }))).toBe("settled");
    expect(names()).not.toContain("slashBond");
    expect(names()).not.toContain("slashProviderStake");
    expect(state.finalized?.status).toBe("failed_compensated");
    expect(state.finalized?.settleTx).toBeUndefined();
    expect(state.finalized?.stakeSlashTx).toBeUndefined();
    expect(state.finalized?.refundTx).toBe("0xrefund");
  });

  test("resume after a death that occurred POST-refund: alreadyRefunded → refund is NOT re-sent (a second RefundVault.refund hard-reverts on-chain)", async () => {
    const { store, state } = fakeStore(row());
    const { chain, names } = fakeChain({
      getBond: async () => ({ status: BondStatus.SLASHED }),
      alreadySlashed: async () => true,
      alreadyRefunded: async () => true,
    });
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 5 }))).toBe("settled");
    expect(names()).not.toContain("refundFromTreasury");
    expect(state.finalized?.status).toBe("failed_compensated");
    expect(state.finalized?.refundTx).toBeUndefined();
    expect(state.retried).toBe(false); // resumes to terminal, not settle_retry-forever
  });

  test("unbonded (best-effort) match → zero chain calls, terminal 'delivered'", async () => {
    const { store, state } = fakeStore(row({ bond_tx: null }));
    const { chain, names } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain, { pass: false, score: 10 }))).toBe("settled");
    expect(names()).toEqual([]);
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
    const { chain, names } = fakeChain();
    expect(await settleMatch("m1", deps(store, chain))).toBe("skipped");
    expect(names()).toEqual([]);
  });

  test("a stored verdict is canonical — the validator is never re-run after money moved", async () => {
    const { store, state } = fakeStore(row(), { pass: true, score: 88 });
    const { chain, names } = fakeChain();
    const d = deps(store, chain, { pass: false, score: 0 }); // fake validate would FAIL the match…
    expect(await settleMatch("m1", d)).toBe("settled");
    expect(state.computeCalls).toBe(0); // …but it is never consulted
    expect(names()).toContain("releaseBond"); // the stored PASS wins
  });

  test("no store (persistence unconfigured) → 'skipped'", async () => {
    const { chain } = fakeChain();
    expect(await settleMatch("m1", deps(null, chain))).toBe("skipped");
  });
});

describe("reputation tail through the SettleTail seam", () => {
  const prodShaped = () => row({ validation_request_tx: "0xreq", providers: { id: "p1", wallet_address: PROVIDER_WALLET, agent_id: "845016", price_usdc: 0.001 } });

  test("prod-shaped row: response + feedback post with the verdict's ACTUAL pass flag, and both txs are recorded", async () => {
    const { store, state } = fakeStore(prodShaped());
    const { chain } = fakeChain();
    const t = fakeTail();
    expect(await settleMatch("m1", deps(store, chain, { pass: true, score: 92 }, t.tail))).toBe("settled");
    expect(t.calls.map((c) => c.fn)).toEqual(["respondValidation", "giveFeedback", "applyOutcome"]);
    const respond = t.calls[0].args[0] as { matchKey: Hex; passed: boolean; score: number };
    expect(respond.matchKey).toBe(KEY);
    expect(respond.passed).toBe(true); // an inverted `passed:` flag must fail HERE, not on the public registry
    expect(respond.score).toBe(92);
    const feedback = t.calls[1].args[0] as { providerAgentId: bigint; passed: boolean };
    expect(feedback.providerAgentId).toBe(845016n);
    expect(feedback.passed).toBe(true);
    const outcome = t.calls[2].args[0] as { providerId: string; pass: boolean };
    expect(outcome.providerId).toBe("p1");
    expect(outcome.pass).toBe(true);
    expect(state.tailTxs).toEqual([
      { col: "validation_response_tx", tx: "0xrespond" },
      { col: "feedback_tx", tx: "0xfeedback" },
    ]);
  });

  test("a tail failure is best-effort: settlement still lands terminal and money is untouched", async () => {
    const { store, state } = fakeStore(prodShaped());
    const { chain, names } = fakeChain();
    const t = fakeTail();
    t.tail.respondValidation = (async () => { throw new Error("registry down"); }) as SettleTail["respondValidation"];
    expect(await settleMatch("m1", deps(store, chain, { pass: true, score: 90 }, t.tail))).toBe("settled");
    expect(state.finalized?.status).toBe("delivered"); // finalize happened BEFORE the tail
    expect(names()).toEqual(["getBond", "releaseBond"]); // no extra money effects from the tail path
    expect(state.retried).toBe(false);
  });
});
