// Client-side chain config + ABIs + public read client. Safe to import in client components.
import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { arcTestnet } from "viem/chains";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.arc.network";
export const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
export const PROVIDER_STAKE = process.env.NEXT_PUBLIC_PROVIDER_STAKE_ADDRESS as Address;
export const ESCROW = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address;
export const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address;
export const ARCSCAN = "https://testnet.arcscan.app";

export { erc20Abi };

export const providerStakeAbi = [
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "request_unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "stakes", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pending", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ name: "amount", type: "uint256" }, { name: "unlock_time", type: "uint256" }] },
  { type: "function", name: "UNSTAKE_COOLDOWN", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const escrowAbi = [
  { type: "function", name: "claim_timeout", stateMutability: "nonpayable", inputs: [{ name: "match_id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "bonds", stateMutability: "view", inputs: [{ name: "match_id", type: "bytes32" }], outputs: [
    { name: "poster", type: "address" }, { name: "requester", type: "address" }, { name: "amount", type: "uint256" },
    { name: "status", type: "uint8" }, { name: "decision_hash", type: "bytes32" }, { name: "deadline", type: "uint256" },
  ] },
] as const;

// IthacaAccount key enumeration — for the account page's "Permissions" (authorized signers)
export const ithacaKeysAbi = [
  { type: "function", name: "getKeys", stateMutability: "view", inputs: [], outputs: [
    { name: "keys", type: "tuple[]", components: [
      { name: "expiry", type: "uint40" }, { name: "keyType", type: "uint8" },
      { name: "isSuperAdmin", type: "bool" }, { name: "publicKey", type: "bytes" },
    ] },
    { name: "keyHashes", type: "bytes32[]" },
  ] },
] as const;

export const gatewayWalletAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] },
] as const;

// resilient transport: the public Arc RPC is flaky; viem's default 10s/thin-retry surfaced
// transient reads as "HTTP request failed" in the UI. Give browser reads room + retries.
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL, { timeout: 15_000, retryCount: 3, retryDelay: 200 }), pollingInterval: 1000 });
export const usdcAtomic = (usdc: number) => BigInt(Math.round(usdc * 1e6));
export const fromAtomic = (v: bigint) => Number(v) / 1e6;
