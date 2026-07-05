"use client";
// Passkey account store — supports MULTIPLE accounts (for the Switch / Sign up modal UX), built on
// Circle Modular Wallets (passkey-owned MSCA on Arc). Persisted in localStorage (testnet demo; the
// stored credential is a public id + P256 public key, not a secret — signing always re-prompts the
// device authenticator).
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Address } from "viem";
import type { StoredCredential } from "@/lib/circleWallet";

export interface PasskeySession {
  address: Address; // the user's Circle smart-account (MSCA) address
  credential: StoredCredential; // WebAuthn credential (id + P256 public key) — rebuilds the account
  label?: string; // optional friendly name
}

const STORE = "engye.passkey.v3"; // v3: Circle MSCA credential shape (was Porto/Ithaca in v2)
interface Store { accounts: PasskeySession[]; current: string | null }
const read = (): Store => {
  try { return JSON.parse(localStorage.getItem(STORE) || "") || { accounts: [], current: null }; }
  catch { return { accounts: [], current: null }; }
};

interface Ctx {
  accounts: PasskeySession[];
  current: PasskeySession | null;
  addAccount: (s: PasskeySession) => void;
  switchTo: (address: string) => void;
  signOut: () => void;
}
const C = createContext<Ctx>({ accounts: [], current: null, addAccount: () => {}, switchTo: () => {}, signOut: () => {} });

export function PasskeyProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>({ accounts: [], current: null });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage on mount (unavailable during SSR/render)
  useEffect(() => setStore(read()), []);
  const persist = useCallback((s: Store) => { localStorage.setItem(STORE, JSON.stringify(s)); setStore(s); }, []);

  const addAccount = (s: PasskeySession) =>
    persist({ accounts: [...store.accounts.filter((a) => a.address !== s.address), s], current: s.address });
  const switchTo = (address: string) => persist({ ...store, current: address });
  const signOut = () => persist({ ...store, current: null });

  const current = store.accounts.find((a) => a.address === store.current) ?? null;
  return <C.Provider value={{ accounts: store.accounts, current, addAccount, switchTo, signOut }}>{children}</C.Provider>;
}

export const usePasskey = () => useContext(C);
