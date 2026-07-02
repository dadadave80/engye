"use client";
// Passkey session — built on Porto's Key module (porto/viem/Key) over the ithacaxyz/account
// contract we deployed on Arc. The passkey is a WebAuthn-P256 super-admin on a per-user
// EIP-7702 Ithaca account; ENGYE self-relays intents (Porto's hosted relay doesn't serve Arc).
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";

export interface PasskeySession {
  address: Address; // the user's Ithaca smart-account (EOA) address
  credentialId: string; // WebAuthn credential id (base64url, from Porto/ox)
  credentialPublicKey: Hex; // ox PublicKey hex — reconstructs the key for signing
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
