"use client";
// Passkey connect + sign on Circle Modular Wallets. Register/login a passkey → derive its MSCA →
// register it server-side (passkey_accounts + a small USDC sponsor). Pay/stake/claim are gasless
// userOps (Gas Station paymaster). Payment is a direct USDC transfer validated + bound server-side.
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { USDC } from "@/lib/clientChain";
import { registerCredential, loginCredential, accountFromCredential, sendCalls, type StoredCredential } from "@/lib/circleWallet";
import type { PasskeySession } from "./passkey";
import type { Call } from "@/lib/ithaca";

// Circle usernames: 5–50 chars, only alphanumeric + _@.:+- (no interpunct/spaces). rand() is base36.
const rand = () => Math.random().toString(36).slice(2, 8);
const genUsername = () => `ENGYE-${rand()}`;

/** Server-side: register the MSCA in passkey_accounts (execute's payer check) + sponsor a little USDC. */
async function registerAccount(credential: StoredCredential, address: string): Promise<void> {
  await fetch("/api/passkey/provision", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId: credential.id, account: address, publicKey: credential.publicKey }),
  }).catch(() => {}); // non-fatal: the sponsor is a convenience, not required to sign in
}

/** Sign up: create a NEW passkey (device biometrics) and derive + register its Circle MSCA. */
export async function signUpPasskey(label?: string): Promise<PasskeySession> {
  const username = label?.trim() || genUsername();
  const credential = await registerCredential(username);
  const account = await accountFromCredential(credential);
  await registerAccount(credential, account.address);
  return { address: account.address, credential, label: username };
}

/** Sign in: pick an EXISTING passkey and derive its Circle MSCA. */
export async function loginPasskey(): Promise<PasskeySession> {
  const credential = await loginCredential();
  const account = await accountFromCredential(credential);
  await registerAccount(credential, account.address); // idempotent — ensures the payer check + sponsor
  return { address: account.address, credential };
}

/** Send an ERC-7821-style batch as one gasless userOp; returns the mined tx hash. */
export async function signAndRelay(session: PasskeySession, calls: Call[]): Promise<Hex> {
  return sendCalls(session.credential, calls);
}

/** Pay an open quote from the passkey MSCA. Discovers payTo+amount from the execute 402, transfers
 *  USDC via a gasless userOp, then binds the tx to the quote server-side (execute honors that binding). */
export async function payForQuote(session: PasskeySession, quoteId: string): Promise<Hex> {
  // self-heal: ensure the account is registered (execute's payer allow-list) + funded (0.25 USDC
  // sponsor) BEFORE paying. Idempotent — a no-op if signup already provisioned. This is what makes
  // a first payment work even if provision failed at signup (e.g. the historical window-503), and
  // it awaits the sponsor tx so the balance has landed before the transfer userOp simulates.
  await registerAccount(session.credential, session.address);
  const probe = await fetch(`/api/broker/execute/${quoteId}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (probe.status !== 402) throw new Error(`expected 402 requirements, got ${probe.status}`);
  const reqs = JSON.parse(atob(probe.headers.get("payment-required")!)).accepts[0];
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [reqs.payTo as `0x${string}`, BigInt(reqs.amount)] });
  const hash = await sendCalls(session.credential, [{ to: USDC, value: 0n, data }]);
  const res = await fetch("/api/passkey/pay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quote_id: quoteId, account: session.address, tx_hash: hash }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "passkey payment failed");
  return hash;
}
