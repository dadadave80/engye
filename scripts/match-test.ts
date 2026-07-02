// Phase 3 acceptance: PASS flow (deliverable delivered, bond released) and FAIL flow via
// the flaky provider (bond slashed + stake slash + vault refund; requester nets price+bond).
// Runs against APP_URL (override: APP_URL=http://localhost:3000 bun scripts/match-test.ts).
import { createPublicClient, http, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { payEndpoint, ensureGatewayFloat } from "../lib/x402";
import { getBond } from "../lib/escrow";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const demandPk = process.env.DEMAND_PRIVATE_KEY!;
const requester = process.env.DEMAND_ADDRESS as Address;
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });

async function getQuote(task: object) {
  const res = await fetch(`${APP}/api/broker/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, requester_wallet: requester }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`quote ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function execute(quoteId: string, maxPrice: number) {
  const { result } = await payEndpoint(`${APP}/api/broker/execute/${quoteId}`, maxPrice, demandPk, {
    method: "POST",
    body: "{}",
  });
  return result;
}

await ensureGatewayFloat(demandPk, 0.05, 0.5);

// ---------- PASS flow ----------
console.log("=== PASS flow ===");
const q1 = await getQuote({
  type: "question-answering",
  spec: "What is the chemical symbol for gold, and what is its atomic number? One sentence.",
  max_price_usdc: 0.01,
});
if (q1.declined) throw new Error(`unexpected decline: ${q1.reason}`);
if (q1.action !== "accept") throw new Error(`expected bonded accept, got ${q1.action}`);
console.log(`quote: provider=${q1.provider_id} confidence=${q1.confidence} bond=$${q1.bond_usdc} total=$${q1.total_price_usdc}`);
console.log(`reasoning: ${q1.reasoning_summary}`);
const r1 = await execute(q1.quote_id, q1.total_price_usdc);
const d1 = r1.data as any;
console.log(`status: ${d1.status} | validation: pass=${d1.validation.pass} score=${d1.validation.score}`);
if (d1.bond_tx) console.log(`bond:    ${d1.bond_tx}\nsettle:  ${d1.settle_tx}`);
if (d1.status !== "delivered" || !d1.validation.pass) throw new Error("PASS flow did not pass");
if (!d1.bond_tx) throw new Error("PASS flow ran unbonded — EV gate rejected the accept");
const bond1 = await getBond(d1.match_key as Hex);
if (bond1.status !== 2) throw new Error(`bond status ${bond1.status}, expected RELEASED(2)`);
console.log("PASS flow ✓ (bond RELEASED on-chain)\n");

// ---------- FAIL flow (loop the flaky provider until a slash lands) ----------
console.log("=== FAIL flow (flaky provider, ~35% bad output) ===");
const before = await pub.getBalance({ address: requester });
let failed: any = null;
for (let i = 1; i <= 12 && !failed; i++) {
  const q = await getQuote({
    type: "lookup",
    spec: `Attempt ${i}: What year did the Berlin Wall fall? Answer with the year and one sentence of context.`,
    max_price_usdc: 0.0008, // only the flaky provider ($0.0005) is affordable
  });
  if (q.declined) {
    console.log(`attempt ${i}: declined (${q.reason})`);
    continue;
  }
  try {
    const r = await execute(q.quote_id, q.total_price_usdc);
    const d = r.data as any;
    console.log(`attempt ${i}: ${d.status} [${q.action}] (score ${d.validation?.score})`);
    if (d.status === "failed_compensated") failed = d;
  } catch (e) {
    console.log(`attempt ${i}: ERROR ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }
}
if (!failed) throw new Error("no slash in 12 attempts — check flaky provider fail rate");
console.log(`slash:       ${failed.slash_tx}`);
console.log(`stake slash: ${failed.stake_slash_tx}`);
console.log(`refund:      ${failed.refund_tx}`);
const bond2 = await getBond(failed.match_key as Hex);
if (bond2.status !== 3) throw new Error(`bond status ${bond2.status}, expected SLASHED(3)`);
const after = await pub.getBalance({ address: requester });
console.log(`requester native balance delta: ${Number(after - before) / 1e18} USDC (bond + refund in, prices out)`);
console.log("\nFAIL flow ✓ (bond SLASHED to requester + vault refund, on-chain)");
console.log("\nPhase 3 acceptance: PASSED");
