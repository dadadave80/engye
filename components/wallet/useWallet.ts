"use client";
// Unified wallet view: one hook the UI reads regardless of connect kind.
// - kind 'eoa'    → wagmi account; can sign Gateway x402 payments (rail A) + contract calls (rail B)
// - kind 'passkey'→ Ithaca smart account; rail B only (Gateway payments are EOA-only)
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { usePasskey } from "./passkey";

export type WalletKind = "eoa" | "passkey";

// Passkey-only for this version. Flip to true to re-enable external/injected (EOA) wallets as a
// usable app account — the connect modal reads the same flag to show/hide its Browser Wallet option.
// (The recovery flow connects an EOA independently to read its address; it is unaffected.)
export const EXTERNAL_WALLETS_ENABLED = false;

export interface WalletView {
  address: Address | null;
  kind: WalletKind | null;
  connected: boolean;
  canPayGateway: boolean; // EOA only
}

export function useWallet(): WalletView {
  const { address: eoa, isConnected } = useAccount();
  const { current } = usePasskey();

  // A passkey session is the user's identity — it takes precedence over a transient EOA
  // connection (e.g. a wallet connected only to pick a recovery method). Otherwise adding
  // recovery would hijack the active account and unmount the flow mid-way.
  if (current) {
    return { address: current.address, kind: "passkey", connected: true, canPayGateway: false };
  }
  if (EXTERNAL_WALLETS_ENABLED && isConnected && eoa) {
    return { address: eoa, kind: "eoa", connected: true, canPayGateway: true };
  }
  return { address: null, kind: null, connected: false, canPayGateway: false };
}
