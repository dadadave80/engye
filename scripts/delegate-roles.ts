// EIP-7702 rollout for the six role accounts, driven entirely by the agent's SESSION key.
// Prereqs (human, one-time): SessionAccount delegate deployed (DELEGATE_ADDRESS),
// root delegated with session registered (`cast send $ROOT "add_signer(address)" $SESSION --auth $DELEGATE`),
// ROOT_ADDRESS set, session EOA holding a little gas.
// Per role: (1) type-4 delegate + initialize(manager=ROOT) atomically,
//           (2) session adds itself as signer via the root hop,
//           (3) fund from root (native USDC value transfer).
// Idempotent — safe to rerun. Run: bun scripts/delegate-roles.ts
import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const DELEGATE = process.env.DELEGATE_ADDRESS as `0x${string}`;
const ROOT = process.env.ROOT_ADDRESS as `0x${string}`;
if (!DELEGATE || !ROOT) throw new Error("Set DELEGATE_ADDRESS and ROOT_ADDRESS in .env.local");

const accountAbi = parseAbi([
  "function initialize(address managerAddr)",
  "function add_signer(address signer)",
  "function signers(address signer) view returns (bool)",
  "function manager() view returns (address)",
  "function execute(address target, uint256 callValue, bytes data) payable returns (bytes memory)",
]);

const transport = http(process.env.RPC ?? undefined);
const pub = createPublicClient({ chain: arcTestnet, transport });
const session = privateKeyToAccount(process.env.SESSION_PRIVATE_KEY as `0x${string}`);
const sessionWallet = createWalletClient({ account: session, chain: arcTestnet, transport });

const rootCode = await pub.getCode({ address: ROOT }).catch(() => undefined);
if (!rootCode || rootCode === "0x") throw new Error("root is not delegated yet — run the cast --auth step first");
const isSigner = await pub.readContract({ address: ROOT, abi: accountAbi, functionName: "signers", args: [session.address] });
if (!isSigner) throw new Error("session key is not a signer on the root account");
console.log(`root ${ROOT} delegated ✓ session ${session.address} authorized ✓ root balance: ${formatEther(await pub.getBalance({ address: ROOT }))} USDC`);

// funding targets (native USDC, 18-dec view): broker deploys contracts + posts bonds + vault float
const ROLES = [
  { name: "BROKER", pkVar: "BROKER_PRIVATE_KEY", fund: "25" },
  { name: "DEMAND", pkVar: "DEMAND_PRIVATE_KEY", fund: "10" },
  { name: "PROVIDER1", pkVar: "PROVIDER1_PRIVATE_KEY", fund: "0.5" },
  { name: "PROVIDER2", pkVar: "PROVIDER2_PRIVATE_KEY", fund: "0.5" },
  { name: "PROVIDER3", pkVar: "PROVIDER3_PRIVATE_KEY", fund: "0.5" },
  { name: "VALIDATOR", pkVar: "VALIDATOR_PRIVATE_KEY", fund: "0.5" },
] as const;

for (const r of ROLES) {
  const roleAccount = privateKeyToAccount(process.env[r.pkVar] as `0x${string}`);
  const role = roleAccount.address;

  // 1) delegate + initialize atomically (same type-4 tx closes the initialize race)
  const code = await pub.getCode({ address: role }).catch(() => undefined);
  if (!code || code === "0x") {
    const nonce = await pub.getTransactionCount({ address: role });
    const auth = await roleAccount.signAuthorization({
      contractAddress: DELEGATE,
      chainId: arcTestnet.id,
      nonce, // sender != authority, so authorization nonce = role's own nonce
    });
    const hash = await sessionWallet.sendTransaction({
      to: role,
      data: encodeFunctionData({ abi: accountAbi, functionName: "initialize", args: [ROOT] }),
      authorizationList: [auth],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.name} delegated + initialized(manager=root): ${hash}`);
  } else {
    const mgr = await pub.readContract({ address: role, abi: accountAbi, functionName: "manager", args: [] });
    console.log(`${r.name} already delegated (manager ${mgr})`);
  }

  // 2) session registers itself on the role account through the root hop
  const already = await pub.readContract({ address: role, abi: accountAbi, functionName: "signers", args: [session.address] });
  if (!already) {
    const hash = await sessionWallet.writeContract({
      address: ROOT,
      abi: accountAbi,
      functionName: "execute",
      args: [role, 0n, encodeFunctionData({ abi: accountAbi, functionName: "add_signer", args: [session.address] })],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.name} session signer added via root hop`);
  }

  // 3) top up from root (value transfer through the root account = native USDC)
  const balance = await pub.getBalance({ address: role });
  const target = parseEther(r.fund);
  if (balance < target) {
    const hash = await sessionWallet.writeContract({
      address: ROOT,
      abi: accountAbi,
      functionName: "execute",
      args: [role, target - balance, "0x"],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.name} funded to ${r.fund} USDC from root`);
  }
  console.log(`${r.name} ready: ${role}`);
}
console.log("\nall role accounts delegated, session-operable, funded ✓");
