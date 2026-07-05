// Phase 3 acceptance: PASS flow (deliverable delivered, bond released) and FAIL flow via
// the flaky provider (bond slashed + stake slash + vault refund; requester nets price+bond).
// Runs against APP_URL (override: APP_URL=http://localhost:3000 bun scripts/match-test.ts).
import { createPublicClient, http, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { createClient } from "@supabase/supabase-js";
import { payEndpoint, ensureGatewayFloat } from "../lib/x402";
import { getBond } from "../lib/escrow";
import { VERDICT_WINDOW_SECONDS } from "../lib/economics";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const demandPk = process.env.DEMAND_PRIVATE_KEY!;
const requester = process.env.DEMAND_ADDRESS as Address;
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Poll the matches row until the async verdict+settlement (Task 6) reaches a terminal status. */
async function awaitVerdict(matchKey: string, timeoutMs = (VERDICT_WINDOW_SECONDS + 120) * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await sb.from("matches").select("status,settle_tx,refund_tx,stake_slash_tx,validations(pass,score)").eq("match_key", matchKey).single();
    if (data && ["delivered", "failed_compensated"].includes(data.status)) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`verdict timeout for ${matchKey}`);
}

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
console.log(`status: ${d1.status} | verdict due: ${d1.verdict_due_at}`);
if (d1.status !== "delivered_awaiting_verdict") throw new Error(`expected delivered_awaiting_verdict, got ${d1.status}`);
if (!d1.bond_tx) throw new Error("PASS flow ran unbonded — EV gate rejected the accept");
console.log(`bond:    ${d1.bond_tx}`);
const f1 = await awaitVerdict(d1.match_key);
console.log(`settled: status=${f1.status} pass=${f1.validations?.[0]?.pass} score=${f1.validations?.[0]?.score}`);
console.log(`settle:  ${f1.settle_tx}`);
if (f1.status !== "delivered" || f1.validations?.[0]?.pass !== true) throw new Error("PASS flow did not pass");
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
    console.log(`attempt ${i}: ${d.status} [${q.action}], awaiting verdict…`);
    const f = await awaitVerdict(d.match_key);
    console.log(`attempt ${i}: settled ${f.status} (score ${f.validations?.[0]?.score})`);
    if (f.status === "failed_compensated") failed = { match_key: d.match_key, ...f };
  } catch (e) {
    console.log(`attempt ${i}: ERROR ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }
}
if (!failed) throw new Error("no slash in 12 attempts — check flaky provider fail rate");
console.log(`slash:       ${failed.settle_tx}`);
console.log(`stake slash: ${failed.stake_slash_tx}`);
console.log(`refund:      ${failed.refund_tx}`);
const bond2 = await getBond(failed.match_key as Hex);
if (bond2.status !== 3) throw new Error(`bond status ${bond2.status}, expected SLASHED(3)`);
const after = await pub.getBalance({ address: requester });
console.log(`requester native balance delta: ${Number(after - before) / 1e18} USDC (bond + refund in, prices out)`);
console.log("\nFAIL flow ✓ (bond SLASHED to requester + vault refund, on-chain)");
console.log("\nPhase 3 acceptance: PASSED");
