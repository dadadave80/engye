"use client";
// Local hint of whether an account has had a recovery phrase registered on-chain. The Circle SDK
// has no cheap read for this, so we remember it per-address for UX ("Recovery active" vs "Set up
// recovery"). Not authoritative — a fresh device won't know — but the on-chain registration is the
// source of truth; this only drives the label. The mnemonic itself is NEVER stored.
const KEY = (address: string) => `engye.recovery.${address.toLowerCase()}`;

export function hasRecoverySet(address: string): boolean {
  try { return localStorage.getItem(KEY(address)) === "1"; } catch { return false; }
}
export function markRecoverySet(address: string): void {
  try { localStorage.setItem(KEY(address), "1"); } catch { /* private mode — label just won't persist */ }
}
