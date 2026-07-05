// Settlement recovery: (A) after() never ran → sweep completes the match.
// (B) died mid-settle AFTER slashBond with verdict stored → sweep finishes refund+stake WITHOUT re-validating.
// Requires the server up with ENGYE_DISABLE_AFTER=1 so Phase B never auto-fires — only our manual
// sweepDueMatches() calls drive settlement, exactly like a cron heartbeat recovering a dead process.
// Run: set -a; source .env.local; set +a; ENGYE_DISABLE_AFTER=1 bun run dev &   (terminal 1)
//      bun scripts/settle-recovery-test.ts                                     (terminal 2)
import { createClient } from "@supabase/supabase-js";
import type { Address, Hex } from "viem";
import { payEndpoint, ensureGatewayFloat } from "../lib/x402";
import { slashBond, getBond } from "../lib/escrow";
import { sweepDueMatches } from "../lib/settle";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const demandPk = process.env.DEMAND_PRIVATE_KEY!;
const requester = process.env.DEMAND_ADDRESS as Address;

// ---- quote + execute helpers, copied verbatim from scripts/match-test.ts (source tag swapped) ----
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
  const { result } = await payEndpoint(`${APP}/api/broker/execute/${quoteId}?source=recovery_test`, maxPrice, demandPk, {
    method: "POST",
    body: "{}",
  });
  return result;
}
/** Retry until the broker accepts a bonded quote (declines/unbonded offers are rare but possible). */
async function bondedQuote(spec: string, maxPriceUsdc: number) {
  for (let i = 0; i < 5; i++) {
    const q = await getQuote({ type: "question-answering", spec, max_price_usdc: maxPriceUsdc });
    if (!q.declined && q.action === "accept") return q;
    console.log(`  quote not bonded (${q.declined ? q.reason : q.action}), retrying…`);
  }
  throw new Error("could not obtain a bonded quote after 5 tries");
}
/** Sweep repeatedly until matchKey reaches a terminal status or we give up — guards against an
 * unrelated settlement backlog eating a single sweep's limit() before it reaches our new match. */
async function sweepUntilTerminal(matchKey: string, maxSweeps = 8) {
  let total = 0;
  for (let i = 0; i < maxSweeps; i++) {
    total += await sweepDueMatches(10);
    const { data } = await sb.from("matches").select("status").eq("match_key", matchKey).single();
    if (data && ["delivered", "failed_compensated"].includes(data.status)) return { swept: total, status: data.status };
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { swept: total, status: null as string | null };
}

await ensureGatewayFloat(demandPk, 0.05, 0.5);

// ---------- Scenario A: after() never ran (ENGYE_DISABLE_AFTER=1) → sweep completes it ----------
console.log("=== Scenario A: missed after() ===");
const qA = await bondedQuote("Recovery test A: what is the chemical symbol for silver? One sentence.", 0.01);
const rA = await execute(qA.quote_id, qA.total_price_usdc);
const dA = rA.data as any;
if (dA.status !== "delivered_awaiting_verdict" || !dA.bond_tx) throw new Error(`scenario A setup failed: ${JSON.stringify(dA)}`);
console.log(`match A: ${dA.match_key} — awaiting verdict at ${dA.verdict_due_at}; sleeping past the window…`);

await new Promise((r) => setTimeout(r, 125_000));
const n1 = await sweepDueMatches(5);
if (n1 < 1) throw new Error("sweep A settled nothing");
let { data: mA } = await sb.from("matches").select("status").eq("match_key", dA.match_key).single();
if (!mA || !["delivered", "failed_compensated"].includes(mA.status)) {
  // defend against an unrelated backlog sharing the sweep's limit() ahead of our match
  const retried = await sweepUntilTerminal(dA.match_key);
  if (!retried.status) throw new Error("recovery A incomplete: " + JSON.stringify(mA));
  mA = { status: retried.status } as any;
}
const bondA = await getBond(dA.match_key as Hex);
if (bondA.status !== 2 && bondA.status !== 3) throw new Error(`bond A not terminal on-chain: status ${bondA.status}`);
console.log(`scenario A ✓ — status=${mA!.status}, bond status=${bondA.status}\n`);

// ---------- Scenario B: died mid-settle AFTER slashBond, verdict pre-stored ----------
console.log("=== Scenario B: mid-settle death after slashBond ===");
const qB = await bondedQuote("Recovery test B: what is the chemical symbol for tin? One sentence.", 0.01);
const rB = await execute(qB.quote_id, qB.total_price_usdc);
const dB = rB.data as any;
if (dB.status !== "delivered_awaiting_verdict" || !dB.bond_tx) throw new Error(`scenario B setup failed: ${JSON.stringify(dB)}`);
const MATCH_KEY_2 = dB.match_key as Hex;
console.log(`match B: ${MATCH_KEY_2}`);

const { data: matchRowB } = await sb.from("matches").select("id").eq("match_key", MATCH_KEY_2).single();
if (!matchRowB) throw new Error("match B row not found");

// 1. verdict already computed and stored — as if a live settler got this far before dying
const insV = await sb.from("validations").insert({ match_id: matchRowB.id, pass: false, score: 10, reasons: ["forced"], model: "manual" });
if (insV.error) throw new Error(`forcing verdict failed: ${insV.error.message}`);
// 2. …money step 1 (slashBond) already happened…
await slashBond(MATCH_KEY_2);
// 3. …then the settler died mid-lease: status stuck at 'validating' with a stale lease. Also force
// verdict_due_at into the past — sweepDueMatches gates the 'validating' recovery branch on
// verdict_due_at < now, which a freshly-created match wouldn't satisfy for another ~120s otherwise.
await sb.from("matches").update({
  status: "validating",
  validating_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  verdict_due_at: new Date(Date.now() - 60_000).toISOString(),
}).eq("id", matchRowB.id);

await new Promise((r) => setTimeout(r, 1_000));
const n2 = await sweepDueMatches(5);
if (n2 < 1) throw new Error("sweep B settled nothing");
let { data: m2 } = await sb.from("matches").select("status,refund_tx,stake_slash_tx,settle_tx").eq("match_key", MATCH_KEY_2).single();
if (!m2 || m2.status !== "failed_compensated" || !m2.refund_tx) {
  const retried = await sweepUntilTerminal(MATCH_KEY_2);
  if (retried.status !== "failed_compensated") throw new Error("recovery B incomplete: " + JSON.stringify(m2));
  ({ data: m2 } = await sb.from("matches").select("status,refund_tx,stake_slash_tx,settle_tx").eq("match_key", MATCH_KEY_2).single());
}
if (m2!.status !== "failed_compensated" || !m2!.refund_tx) throw new Error("recovery B incomplete: " + JSON.stringify(m2));
const bond2 = await getBond(MATCH_KEY_2);
if (bond2.status !== 3) throw new Error("bond not slashed");
console.log(`scenario B ✓ — refund_tx=${m2!.refund_tx} stake_slash_tx=${m2!.stake_slash_tx}\n`);

console.log("settle recovery ✓ (A: missed after(); B: mid-settle death after slashBond)");
