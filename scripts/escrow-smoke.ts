// Phase 2 acceptance: real bond→release and bond→slash(+vault refund) on Arc testnet.
// Run: bun scripts/escrow-smoke.ts
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  ensureAllowance,
  fundVault,
  createBond,
  releaseBond,
  slashBond,
  refundFromTreasury,
  getBond,
  arcscanTx,
} from "../lib/escrow";

const requester = process.env.DEMAND_ADDRESS as Address;
const stamp = Date.now();
const m1 = keccak256(toBytes(`smoke-release-${stamp}`)) as Hex;
const m2 = keccak256(toBytes(`smoke-slash-${stamp}`)) as Hex;

console.log("1/6 approving escrow allowance…");
await ensureAllowance();

console.log("2/6 funding refund vault with 5 USDC…");
console.log("   ", arcscanTx(await fundVault(5)));

const decision1 = JSON.stringify({ action: "accept", confidence: 0.93, reasoning: "phase-2 smoke: release path" });
console.log("3/6 bond→release path (0.05 USDC)…");
console.log("    bond:   ", arcscanTx(await createBond(m1, 0.05, requester, decision1)));
console.log("    release:", arcscanTx(await releaseBond(m1)));

const decision2 = JSON.stringify({ action: "accept", confidence: 0.61, reasoning: "phase-2 smoke: slash path" });
console.log("4/6 bond→slash path (0.05 USDC)…");
console.log("    bond: ", arcscanTx(await createBond(m2, 0.05, requester, decision2)));
console.log("    slash:", arcscanTx(await slashBond(m2)));

console.log("5/6 vault refund to requester (0.02 USDC, once-per-match)…");
console.log("   ", arcscanTx(await refundFromTreasury(m2, requester, 0.02)));

console.log("6/6 verifying on-chain state…");
const b1 = await getBond(m1);
const b2 = await getBond(m2);
if (b1.status !== 2) throw new Error(`match1 status ${b1.status}, expected RELEASED(2)`);
if (b2.status !== 3) throw new Error(`match2 status ${b2.status}, expected SLASHED(3)`);
console.log(`    match1 RELEASED ✓ (decision_hash ${b1.decisionHash.slice(0, 18)}…)`);
console.log(`    match2 SLASHED ✓ requester ${b2.requester}`);
console.log("\nPhase 2 acceptance: PASSED — bonds, slash, and idempotent refund live on Arc.");
