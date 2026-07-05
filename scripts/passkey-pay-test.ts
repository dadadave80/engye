// Task 7 acceptance: the relay-bound passkey payment rail (spec §5).
// Provisions a real headless-passkey Ithaca account (pattern-copied from recovery-onchain.ts),
// funds it a little USDC from the broker wallet, gets a live bonded quote, then exercises the
// full attack surface the design closes BEFORE relaying: wrong-amount, wrong-token, replay,
// rebind (same proof, different quote), and a concurrent double-charge on the SAME quote (review
// fix — migration 0006's atomic claim) — plus the happy path end-to-end through settlement.
// Run against local dev: APP_URL=http://localhost:3000 bun scripts/passkey-pay-test.ts
import { createPublicClient, createWalletClient, http, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { createClient } from "@supabase/supabase-js";
import * as Key from "porto/viem/Key";
import { accountDigest, packExecutionData, ithacaAbi, type Call } from "../lib/ithaca";
import { usdcAtomic } from "../lib/escrow";
import { VERDICT_WINDOW_SECONDS } from "../lib/economics";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const BROKER = process.env.BROKER_ADDRESS as Address;
const PROVIDER_STAKE = process.env.PROVIDER_STAKE_ADDRESS as Address;

const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });
const broker = createWalletClient({ account: privateKeyToAccount(process.env.BROKER_PRIVATE_KEY as Hex), chain: arcTestnet, transport: http(process.env.RPC) });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** Poll the matches row until the async verdict+settlement (Task 6) reaches a terminal status. */
async function awaitVerdict(matchKey: string, timeoutMs = (VERDICT_WINDOW_SECONDS + 120) * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await sb
      .from("matches")
      .select("status,settle_tx,refund_tx,stake_slash_tx,requester_wallet,validations(pass,score)")
      .eq("match_key", matchKey)
      .single();
    if (data && ["delivered", "failed_compensated"].includes(data.status)) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`verdict timeout for ${matchKey}`);
}

async function getQuote(task: object, requesterWallet: string) {
  const res = await fetch(`${APP}/api/broker/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, requester_wallet: requesterWallet }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`quote ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function payReq(quoteId: string, account: Address, executionData: Hex) {
  const res = await fetch(`${APP}/api/passkey/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quote_id: quoteId, account, executionData }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ---------- 1. provision a headless passkey account through the real HTTP endpoint ----------
// createHeadlessWebAuthnP256() (unlike the browser's createWebAuthnP256) is a raw in-memory P-256
// key, not a real WebAuthn credential — there's no `credential.id` to read. The provision route
// only needs an opaque, unique string for storage/idempotency, so use the key's own hash.
console.log("1. provisioning passkey account…");
const key = Key.createHeadlessWebAuthnP256();
const serialized = Key.serialize(key);
const credentialId = key.hash as string;
const provRes = await fetch(`${APP}/api/passkey/provision`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ credentialId, key: serialized }),
});
const provBody = await provRes.json();
if (!provRes.ok) throw new Error(`provision failed: ${JSON.stringify(provBody)}`);
const account = provBody.account as Address;
console.log(`   account = ${account}`);

/** Passkey-sign an ERC-7821 batch for `account` (headless key already in memory — no relay). */
async function sign(calls: Call[]): Promise<Hex> {
  const { digest, nonce } = await accountDigest(account, calls);
  const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as Hex;
  return packExecutionData(calls, nonce, wrapped);
}

/**
 * Like sign(), but reads the nonce from an explicit seqKey (Ithaca's 2D nonce: getNonce(seqKey))
 * instead of accountDigest's hardcoded seqKey=0. This mints two INDEPENDENTLY-valid intents on the
 * same account for the concurrency test below — if we instead reused the same seqKey for both,
 * whichever one lost the DB race would ALSO revert on-chain from nonce reuse even without the fix,
 * which would prove nothing. Two distinct seqKeys means both intents are individually relayable,
 * so the test genuinely exercises "the DB claim — not on-chain nonce collision — is what blocks
 * the loser".
 */
async function signWithSeqKey(calls: Call[], seqKey: bigint): Promise<Hex> {
  const nonce = await pub.readContract({ address: account, abi: ithacaAbi, functionName: "getNonce", args: [seqKey] });
  const digest = await pub.readContract({ address: account, abi: ithacaAbi, functionName: "computeDigest", args: [calls, nonce] });
  const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as Hex;
  return packExecutionData(calls, nonce, wrapped);
}

// ---------- 2. fund the account a little USDC from the broker wallet ----------
console.log("2. funding account with 0.05 USDC from the broker wallet…");
try {
  const fundHash = await broker.writeContract({
    address: USDC, abi: erc20Abi, functionName: "transfer", args: [account, usdcAtomic(0.05)],
  });
  await pub.waitForTransactionReceipt({ hash: fundHash });
  console.log(`   funded: https://testnet.arcscan.app/tx/${fundHash}`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`BLOCKER: broker wallet could not fund the passkey account: ${message}`);
  console.error("This is the known human faucet dependency (broker wallet low on USDC) — not a code defect.");
  process.exit(2);
}

// ---------- 3. get a live bonded quote (retry a few times for a bonded "accept") ----------
console.log("3. requesting a bonded quote…");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let quote: any = null;
for (let i = 0; i < 5; i++) {
  quote = await getQuote({ type: "answer", spec: "capital of France? one word", max_price_usdc: 0.05 }, account);
  if (!quote.declined && quote.action === "accept") break;
  console.log(`   attempt ${i + 1}: ${quote.declined ? `declined (${quote.reason})` : `action=${quote.action}, retrying for bonded accept`}`);
}
if (!quote || quote.declined) throw new Error(`could not get an open quote: ${JSON.stringify(quote)}`);
if (quote.action !== "accept") throw new Error(`could not get a bonded accept after retries — got action=${quote.action}`);
console.log(`   quote_id=${quote.quote_id} total=$${quote.total_price_usdc} action=${quote.action}`);
const expected = usdcAtomic(quote.total_price_usdc);

// ---------- 4. NEGATIVE: wrong amount ----------
console.log("4. NEGATIVE wrong-amount…");
const wrongAmountCalls: Call[] = [{
  to: USDC, value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BROKER, expected + 1n] }),
}];
const r4 = await payReq(quote.quote_id, account, await sign(wrongAmountCalls));
assert(r4.status === 400, `expected 400 for wrong-amount, got ${r4.status}: ${JSON.stringify(r4.body)}`);
console.log(`   ✓ 400 rejected wrong amount (${r4.body.error})`);

// ---------- 5. NEGATIVE: wrong token (calls[0].to = PROVIDER_STAKE, not USDC) ----------
console.log("5. NEGATIVE wrong-token…");
const wrongTokenCalls: Call[] = [{
  to: PROVIDER_STAKE, value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BROKER, expected] }),
}];
const r5 = await payReq(quote.quote_id, account, await sign(wrongTokenCalls));
assert(r5.status === 400 && /one USDC transfer/i.test(r5.body.error ?? ""), `expected 400 "one USDC transfer", got ${r5.status}: ${JSON.stringify(r5.body)}`);
console.log(`   ✓ 400 rejected wrong token (${r5.body.error})`);

// ---------- 6. HAPPY: exact transfer(BROKER, total) ----------
console.log("6. HAPPY — exact transfer(BROKER, total)…");
const goodCalls: Call[] = [{
  to: USDC, value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BROKER, expected] }),
}];
const goodExecutionData = await sign(goodCalls);
const r6 = await payReq(quote.quote_id, account, goodExecutionData);
assert(r6.status === 200 && !!r6.body.hash, `expected 200 {hash}, got ${r6.status}: ${JSON.stringify(r6.body)}`);
const hash = r6.body.hash as Hex;
console.log(`   ✓ paid: https://testnet.arcscan.app/tx/${hash}`);

// ---------- 7. REPLAY: same quote again ----------
console.log("7. REPLAY — same quote, same proof…");
const r7 = await payReq(quote.quote_id, account, goodExecutionData);
assert(r7.status === 409, `expected 409 replay, got ${r7.status}: ${JSON.stringify(r7.body)}`);
console.log(`   ✓ 409 rejected replay (${r7.body.error})`);

// ---------- 8. execute with the proof header ----------
console.log("8. execute with x-engye-payment-tx…");
const r8res = await fetch(`${APP}/api/broker/execute/${quote.quote_id}`, {
  method: "POST", headers: { "content-type": "application/json", "x-engye-payment-tx": hash }, body: "{}",
});
const r8 = await r8res.json();
assert(r8res.status === 200 && r8.status === "delivered_awaiting_verdict", `expected 200 delivered_awaiting_verdict, got ${r8res.status}: ${JSON.stringify(r8)}`);
console.log(`   ✓ ${r8.status} — match_key=${r8.match_key} bond=${r8.bond_tx}`);

// ---------- 9. REBIND: second quote, execute with the SAME proof ----------
console.log("9. REBIND — second quote, same proof header…");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let quote2: any = null;
for (let i = 0; i < 5; i++) {
  quote2 = await getQuote({ type: "answer", spec: "capital of Germany? one word", max_price_usdc: 0.05 }, account);
  if (!quote2.declined) break;
  console.log(`   attempt ${i + 1}: declined (${quote2.reason}), retrying`);
}
if (!quote2 || quote2.declined) throw new Error(`could not get a second open quote: ${JSON.stringify(quote2)}`);
const r9res = await fetch(`${APP}/api/broker/execute/${quote2.quote_id}`, {
  method: "POST", headers: { "content-type": "application/json", "x-engye-payment-tx": hash }, body: "{}",
});
const r9 = await r9res.json();
assert(r9res.status === 402 && /no payment bound/i.test(r9.error ?? ""), `expected 402 "no payment bound", got ${r9res.status}: ${JSON.stringify(r9)}`);
console.log(`   ✓ 402 rejected rebind (${r9.error})`);

// ---------- 10. await the verdict; if FAIL, refund must land at the passkey account ----------
console.log("10. awaiting verdict…");
const final = await awaitVerdict(r8.match_key);
console.log(`   settled: status=${final.status} pass=${final.validations?.[0]?.pass} score=${final.validations?.[0]?.score}`);
if (final.status === "failed_compensated") {
  assert((final.requester_wallet ?? "").toLowerCase() === account.toLowerCase(), `refund requester_wallet ${final.requester_wallet} !== passkey account ${account}`);
  console.log(`   ✓ FAIL flow: refund (${final.refund_tx}) bound to the passkey account`);
} else {
  console.log(`   ✓ PASS flow: bond released (${final.settle_tx})`);
}

// ---------- 11. CONCURRENCY: two concurrent /api/passkey/pay for the SAME fresh quote ----------
// Review fix: /api/passkey/pay used to SELECT-then-relay-then-INSERT with no DB-level exclusion,
// so two concurrent requests for the same quote (distinct signed intents, different nonces) could
// both pass the SELECT, both relay on-chain, and both persist — double-charging the quote. The fix
// (migration 0006's partial unique index on payments(quote_id) where direction='inbound') claims a
// pending row BEFORE relay; the loser's INSERT hits the unique violation and 409s pre-relay.
console.log("11. CONCURRENCY — two concurrent pays for the same fresh quote…");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let quote3: any = null;
for (let i = 0; i < 5; i++) {
  quote3 = await getQuote({ type: "answer", spec: "capital of Italy? one word", max_price_usdc: 0.05 }, account);
  if (!quote3.declined) break;
  console.log(`   attempt ${i + 1}: declined (${quote3.reason}), retrying`);
}
if (!quote3 || quote3.declined) throw new Error(`could not get a third open quote: ${JSON.stringify(quote3)}`);
console.log(`   quote_id=${quote3.quote_id} total=$${quote3.total_price_usdc}`);
const expected3 = usdcAtomic(quote3.total_price_usdc);
const concurrentCalls: Call[] = [{
  to: USDC, value: 0n,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BROKER, expected3] }),
}];
// sign both intents up front (sequentially — signing itself isn't what we're racing), THEN fire
// both HTTP requests together so the race is on the server's claim-then-relay path, not on signing.
const [intentA, intentB] = [await signWithSeqKey(concurrentCalls, 0n), await signWithSeqKey(concurrentCalls, 1n)];
const [respA, respB] = await Promise.all([
  payReq(quote3.quote_id, account, intentA),
  payReq(quote3.quote_id, account, intentB),
]);
const statuses = [respA.status, respB.status].sort((a, b) => a - b);
assert(
  statuses[0] === 200 && statuses[1] === 409,
  `expected exactly one 200 and one 409, got ${respA.status} & ${respB.status}: ${JSON.stringify([respA.body, respB.body])}`,
);
const winner = respA.status === 200 ? respA.body : respB.body;
const loser = respA.status === 409 ? respA.body : respB.body;
const { data: rows, error: rowsErr } = await sb
  .from("payments").select("id,gateway_tx").eq("quote_id", quote3.quote_id).eq("direction", "inbound");
if (rowsErr) throw new Error(`payments query failed: ${rowsErr.message}`);
assert(rows?.length === 1, `expected exactly ONE inbound payment row for the quote, got ${rows?.length}: ${JSON.stringify(rows)}`);
assert(rows[0].gateway_tx === winner.hash, `persisted gateway_tx ${rows[0].gateway_tx} !== winner's hash ${winner.hash}`);
console.log(`   ✓ one 200 (${winner.hash}), one 409 (${loser.error}), exactly 1 payment row persisted (gateway_tx=${rows[0].gateway_tx})`);

console.log("\npasskey pay rail ✓ (happy, wrong-amount, wrong-token, replay, rebind, concurrency)");
