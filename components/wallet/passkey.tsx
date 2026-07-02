"use client";
// Passkey → IthacaAccount smart-wallet connect (the innovation layer).
// A WebAuthn P-256 credential is authorized as a signer on an Ithaca smart account; the
// account signs rail-B contract calls as ERC-7821 intents (encodings proven in
// contracts/test/IthacaRoot.t.sol + scripts/root-smoke.ts). Rail-A Gateway payments are
// EOA-only (ecrecover), so passkey sessions do stake/claim, not x402 pay.
//
// This context tracks whether a passkey account is connected and exposes its address.
// The actual enrollment (create credential → authorize on an Ithaca account → fund) is a
// server-assisted flow wired in PasskeyEnroll; here we hold the resulting session.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Address } from "viem";

export interface PasskeySession {
  address: Address; // the user's Ithaca smart-account address
  credentialId: string; // base64url WebAuthn credential id
  pubKey: { x: string; y: string }; // P-256 public key, hex
}

interface PasskeyCtx {
  session: PasskeySession | null;
  setSession: (s: PasskeySession | null) => void;
}

const Ctx = createContext<PasskeyCtx>({ session: null, setSession: () => {} });

export function PasskeyProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PasskeySession | null>(null);
  return <Ctx.Provider value={{ session, setSession }}>{children}</Ctx.Provider>;
}

export const usePasskey = () => useContext(Ctx);
