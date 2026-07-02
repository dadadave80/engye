// Rail B — BondedEscrow bindings (plain USDC ERC-20 transfers on Arc; gas is USDC).
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const escrowAbi = parseAbi([
  "function create_bond(bytes32 matchId, uint256 amount, address requester)",
  "function release(bytes32 matchId)",
  "function slash(bytes32 matchId)",
  "function bonds(bytes32 matchId) view returns (address poster, address requester, uint256 amount, uint8 status)",
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
  fn: "create_bond" | "release" | "slash",
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

export async function createBond(matchId: Hex, amountUsdc: number, requester: Address): Promise<Hex> {
  return write("create_bond", [matchId, usdcAtomic(amountUsdc), requester]);
}

export const releaseBond = (matchId: Hex): Promise<Hex> => write("release", [matchId]);
export const slashBond = (matchId: Hex): Promise<Hex> => write("slash", [matchId]);

/** Treasury price refund to the requester (rail B, plain USDC transfer). */
export async function refundFromTreasury(to: Address, amountUsdc: number): Promise<Hex> {
  const { pub, wallet, account } = clients();
  const hash = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, usdcAtomic(amountUsdc)],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`refund reverted: ${hash}`);
  return hash;
}

export async function getBond(matchId: Hex) {
  const { pub } = clients();
  const [poster, requester, amount, status] = await pub.readContract({
    address: escrowAddress(),
    abi: escrowAbi,
    functionName: "bonds",
    args: [matchId],
  });
  return { poster, requester, amount, status }; // status: 1 OPEN, 2 RELEASED, 3 SLASHED
}

export const arcscanTx = (hash: string): string => `https://testnet.arcscan.app/tx/${hash}`;
