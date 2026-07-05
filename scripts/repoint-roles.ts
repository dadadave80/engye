// Re-point role EOAs to the verified SessionAccount. Only the type-4 re-delegation;
// storage (manager, signers) survives untouched (same v2 source, 7702 SetCode swaps
// code pointer only). See docs/superpowers/plans/2026-07-05-repoint-roles-to-verified-delegate.md
// Usage: bun scripts/repoint-roles.ts               (all six)
//        bun scripts/repoint-roles.ts PROVIDER3      (one role — canary)
//        bun scripts/repoint-roles.ts PROVIDER3 --to 0x31dc3a57774fb5d664942adf2daf49ebf584061c   (rollback)
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const argv = process.argv.slice(2);
const only = argv.find((a) => !a.startsWith("--"));
const toIdx = argv.indexOf("--to");
const DELEGATE = (toIdx >= 0 ? argv[toIdx + 1] : process.env.DELEGATE_ADDRESS) as `0x${string}`;
if (!DELEGATE) throw new Error("Set DELEGATE_ADDRESS in .env.local (or pass --to <addr>)");

const abi = parseAbi([
  "function manager() view returns (address)",
  "function signers(address) view returns (bool)",
]);
const transport = http(process.env.RPC ?? undefined);
const pub = createPublicClient({ chain: arcTestnet, transport });
const session = privateKeyToAccount(process.env.SESSION_PRIVATE_KEY as `0x${string}`);
const sessionWallet = createWalletClient({ account: session, chain: arcTestnet, transport });
const ROOT = process.env.ROOT_ADDRESS as `0x${string}`;

const ROLES = [
  { name: "BROKER", pk: "BROKER_PRIVATE_KEY" },
  { name: "DEMAND", pk: "DEMAND_PRIVATE_KEY" },
  { name: "PROVIDER1", pk: "PROVIDER1_PRIVATE_KEY" },
  { name: "PROVIDER2", pk: "PROVIDER2_PRIVATE_KEY" },
  { name: "PROVIDER3", pk: "PROVIDER3_PRIVATE_KEY" },
  { name: "VALIDATOR", pk: "VALIDATOR_PRIVATE_KEY" },
] as const;
const targets = only ? ROLES.filter((r) => r.name === only) : ROLES;
if (!targets.length) throw new Error(`unknown role: ${only}`);
console.log(`SESSION gas: ${formatEther(await pub.getBalance({ address: session.address }))} USDC → delegate ${DELEGATE}\n`);

const expected = `0xef0100${DELEGATE.slice(2)}`.toLowerCase();
for (const r of targets) {
  const acct = privateKeyToAccount(process.env[r.pk] as `0x${string}`);
  const role = acct.address;
  const code = ((await pub.getCode({ address: role }).catch(() => "0x")) ?? "0x").toLowerCase();
  if (code === "0x") { console.log(`${r.name} ${role}  SKIP — never delegated (use delegate-roles.ts)`); continue; }
  if (code === expected) { console.log(`${r.name} ${role}  already on ${DELEGATE}`); }
  else {
    const auth = await acct.signAuthorization({
      contractAddress: DELEGATE, chainId: arcTestnet.id,
      nonce: await pub.getTransactionCount({ address: role }),
    });
    const hash = await sessionWallet.sendTransaction({ to: role, authorizationList: [auth] });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.name} ${role}  re-pointed → ${DELEGATE}: ${hash}`);
  }
  // verify storage survived
  const mgr = await pub.readContract({ address: role, abi, functionName: "manager" });
  const sig = await pub.readContract({ address: role, abi, functionName: "signers", args: [session.address] });
  const ok = mgr.toLowerCase() === ROOT.toLowerCase() && sig === true;
  console.log(`   manager=${mgr} (root ${mgr.toLowerCase() === ROOT.toLowerCase() ? "✓" : "✗"})  signers[session]=${sig}  ${ok ? "OK" : "*** CHECK FAILED — halt & rollback ***"}`);
  if (!ok) throw new Error(`${r.name}: post-repoint state check failed — roll back with --to 0x31dc3a57774fb5d664942adf2daf49ebf584061c`);
}
console.log("\ndone ✓");
