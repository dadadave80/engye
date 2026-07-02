"use client";
// Unified wallet view: one hook the UI reads regardless of connect kind.
// - kind 'eoa'    → wagmi account; can sign Gateway x402 payments (rail A) + contract calls (rail B)
// - kind 'passkey'→ Ithaca smart account; rail B only (Gateway payments are EOA-only)
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { usePasskey } from "./passkey";

export type WalletKind = "eoa" | "passkey";

export interface WalletView {
  address: Address | null;
  kind: WalletKind | null;
  connected: boolean;
  canPayGateway: boolean; // EOA only
}

export function useWallet(): WalletView {
  const { address: eoa, isConnected } = useAccount();
  const { session } = usePasskey();

  if (isConnected && eoa) {
    return { address: eoa, kind: "eoa", connected: true, canPayGateway: true };
  }
  if (session) {
    return { address: session.address, kind: "passkey", connected: true, canPayGateway: false };
  }
  return { address: null, kind: null, connected: false, canPayGateway: false };
}
