// Rail B — BondedEscrow bindings (plain USDC ERC-20 transfers on Arc; gas is USDC).
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const escrowAbi = parseAbi([
  "function create_bond(bytes32 matchId, uint256 amount, address requester, bytes32 decisionHash, uint256 deadline)",
  "function release(bytes32 matchId)",
  "function slash(bytes32 matchId)",
  "function claim_timeout(bytes32 matchId)",
  "function bonds(bytes32 matchId) view returns (address poster, address requester, uint256 amount, uint8 status, bytes32 decisionHash, uint256 deadline)",
  "function resolver() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;

export const usdcAtomic = (usdc: number): bigint => BigInt(Math.round(usdc * 1e6));

function escrowAddress(): Address {
  const a = process.env.ESCROW_ADDRESS;
  if (!a) throw new Error("ESCROW_ADDRESS not set — deploy BondedEscrow first (Phase 2)");
  return a as Address;
}

function clients() {
  const pk = process.env.BROKER_PRIVATE_KEY;
  if (!pk) throw new Error("BROKER_PRIVATE_KEY missing");
  const account = privateKeyToAccount(pk as Hex);
  const transport = http(process.env.RPC ?? undefined);
  return {
    account,
    pub: createPublicClient({ chain: arcTestnet, transport }),
    wallet: createWalletClient({ chain: arcTestnet, transport, account }),
  };
}

async function write(
  fn: "create_bond" | "release" | "slash" | "claim_timeout",
  args: readonly unknown[],
): Promise<Hex> {
  const { pub, wallet, account } = clients();
  const hash = await wallet.writeContract({
    address: escrowAddress(),
    abi: escrowAbi,
    functionName: fn,
    args: args as never,
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${fn} reverted: ${hash}`);
  return hash;
}

/** One-time (idempotent) max-approve of the escrow to pull broker USDC. */
export async function ensureAllowance(): Promise<void> {
  const { pub, wallet, account } = clients();
  const allowance = await pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, escrowAddress()],
  });
  if (allowance > 2n ** 128n) return;
  const hash = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrowAddress(), 2n ** 256n - 1n],
    account,
  });
  await pub.waitForTransactionReceipt({ hash });
}

/** keccak256 of the broker's full decision JSON — committed on-chain with the bond. */
export const decisionHash = (decisionJson: string): Hex => keccak256(toBytes(decisionJson));

export async function createBond(
  matchId: Hex,
  amountUsdc: number,
  requester: Address,
  decisionJson: string,
  ttlSeconds = 600,
): Promise<Hex> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
  return write("create_bond", [
    matchId,
    usdcAtomic(amountUsdc),
    requester,
    decisionHash(decisionJson),
    deadline,
  ]);
}

export const releaseBond = (matchId: Hex): Promise<Hex> => write("release", [matchId]);
export const slashBond = (matchId: Hex): Promise<Hex> => write("slash", [matchId]);
/** Permissionless rescue after deadline — pays the requester even if the resolver is dead. */
export const claimTimeout = (matchId: Hex): Promise<Hex> => write("claim_timeout", [matchId]);

const vaultAbi = parseAbi([
  "function fund(uint256 amount)",
  "function refund(bytes32 matchId, address to, uint256 amount)",
  "function refunded(bytes32 matchId) view returns (uint256)",
]);

const stakeAbi = parseAbi([
  "function stakes(address provider) view returns (uint256)",
  "function slash_stake(bytes32 matchId, address provider, address requester, uint256 amount) returns (uint256)",
]);

function vaultAddress(): Address {
  const a = process.env.REFUND_VAULT_ADDRESS;
  if (!a) throw new Error("REFUND_VAULT_ADDRESS not set — deploy contracts first (Phase 2)");
  return a as Address;
}

function stakeAddress(): Address {
  const a = process.env.PROVIDER_STAKE_ADDRESS;
  if (!a) throw new Error("PROVIDER_STAKE_ADDRESS not set — deploy contracts first (Phase 2)");
  return a as Address;
}

/** Price refund to the requester via RefundVault — once-per-match enforced on-chain. */
export async function refundFromTreasury(matchId: Hex, to: Address, amountUsdc: number): Promise<Hex> {
  const { pub, wallet, account } = clients();
  const hash = await wallet.writeContract({
    address: vaultAddress(),
    abi: vaultAbi,
    functionName: "refund",
    args: [matchId, to, usdcAtomic(amountUsdc)],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`refund reverted: ${hash}`);
  return hash;
}

/** Move broker USDC into the refund float (needs ensureAllowance for the vault). */
export async function fundVault(amountUsdc: number): Promise<Hex> {
  const { pub, wallet, account } = clients();
  const approve = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [vaultAddress(), usdcAtomic(amountUsdc)],
    account,
  });
  await pub.waitForTransactionReceipt({ hash: approve });
  const hash = await wallet.writeContract({
    address: vaultAddress(),
    abi: vaultAbi,
    functionName: "fund",
    args: [usdcAtomic(amountUsdc)],
    account,
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

/** Provider co-insurance stake (0 if unstaked) — the broker LLM reads this as a trust signal. */
export async function getProviderStake(provider: Address): Promise<bigint> {
  const { pub } = clients();
  return pub.readContract({
    address: stakeAddress(),
    abi: stakeAbi,
    functionName: "stakes",
    args: [provider],
  });
}

/** On fail: slash provider stake (capped at stake, once per match) to the requester, on top of the bond. */
export async function slashProviderStake(
  matchId: Hex,
  provider: Address,
  requester: Address,
  amountUsdc: number,
): Promise<Hex> {
  const { pub, wallet, account } = clients();
  const hash = await wallet.writeContract({
    address: stakeAddress(),
    abi: stakeAbi,
    functionName: "slash_stake",
    args: [matchId, provider, requester, usdcAtomic(amountUsdc)],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`slash_stake reverted: ${hash}`);
  return hash;
}

export async function getBond(matchId: Hex) {
  const { pub } = clients();
  const [poster, requester, amount, status, decision, deadline] = await pub.readContract({
    address: escrowAddress(),
    abi: escrowAbi,
    functionName: "bonds",
    args: [matchId],
  });
  // status: 1 OPEN, 2 RELEASED, 3 SLASHED, 4 TIMEOUT_CLAIMED
  return { poster, requester, amount, status, decisionHash: decision, deadline };
}

export const arcscanTx = (hash: string): string => `https://testnet.arcscan.app/tx/${hash}`;

/** ERC-20 (6-dec) USDC balance of any address, as a float. */
export async function usdcBalance(addr: Address): Promise<number> {
  const { pub } = clients();
  const raw = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
  return Number(raw) / 1e6;
}

/** Native (gas) balance in USDC (18-dec view). */
export async function gasBalance(addr: Address): Promise<number> {
  const { pub } = clients();
  return Number(await pub.getBalance({ address: addr })) / 1e18;
}
