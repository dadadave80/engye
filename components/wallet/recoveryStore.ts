"use client";
// Local hint of which EOA a passkey account has registered as its recovery key. The Circle SDK has
// no cheap read for this, so we remember it per-address for UX (show the registered wallet). Not
// authoritative — a fresh device won't know — but the on-chain registration is the source of truth;
// this only drives the label.
const KEY = (account: string) => `engye.recovery.${account.toLowerCase()}`;

export function getRecoveryAddress(account: string): string | null {
  try { return localStorage.getItem(KEY(account)); } catch { return null; }
}
export function setRecoveryAddress(account: string, recovery: string): void {
  try { localStorage.setItem(KEY(account), recovery); } catch { /* private mode — label just won't persist */ }
}
