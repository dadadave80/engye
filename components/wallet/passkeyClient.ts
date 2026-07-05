"use client";
// Passkey connect + sign, built on Porto's Key module (the official client for the
// ithacaxyz/account contract we deployed). Create a WebAuthn key, provision an Ithaca account
// for it (server), and sign ERC-7821 intents with Porto's Key.sign → ENGYE self-relays.
import * as Key from "porto/viem/Key";
import * as PublicKey from "ox/PublicKey";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { accountDigest, packExecutionData, type Call } from "@/lib/ithaca";
import { USDC } from "@/lib/clientChain";
import type { PasskeySession } from "./passkey";

const rpId = () => (typeof window !== "undefined" ? window.location.hostname : "engye.vercel.app");

/** Sign up: create a NEW WebAuthn passkey (Face ID / Touch ID) and provision its Ithaca account. */
export async function signUpPasskey(label?: string): Promise<PasskeySession> {
  if (typeof window === "undefined") throw new Error("passkey requires a browser");
  // 1. create the WebAuthn passkey (Porto/ox handles the credential + P-256 key).
  //    Porto doesn't set authenticatorAttachment, so mobile Chrome offers NFC/USB security keys
  //    instead of the device's own biometrics. Prefer `platform` (Face ID / Touch ID / Android
  //    screen lock) — but only when the device REPORTS a platform authenticator (UVPAA); forcing
  //    it on devices without one makes creation fail outright. If the forced path still fails,
  //    retry unrestricted so the user at least gets the picker.
  const createFn = (attachment?: "platform") => (options?: { publicKey?: unknown }) => {
    const pk = options?.publicKey as PublicKeyCredentialCreationOptions | undefined;
    const patched = attachment && pk
      ? { ...options, publicKey: { ...pk, authenticatorSelection: { ...pk.authenticatorSelection, authenticatorAttachment: attachment } } }
      : options;
    // ox vendors its own WebAuthn types; runtime shape is the DOM's CredentialCreationOptions
    return navigator.credentials.create(patched as CredentialCreationOptions);
  };
  const platformOk = await window.PublicKeyCredential
    ?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false) ?? false;
  const params = { label: label || "ENGYE", rpId: rpId() };
  let key: Awaited<ReturnType<typeof Key.createWebAuthnP256>>;
  try {
    key = await Key.createWebAuthnP256({ ...params, createFn: createFn(platformOk ? "platform" : undefined) });
  } catch (e) {
    if (!platformOk) throw e; // wasn't the attachment's fault — surface the real failure
    key = await Key.createWebAuthnP256({ ...params, createFn: createFn(undefined) });
  }
  const serialized = Key.serialize(key); // { expiry, isSuperAdmin, keyType, publicKey } — contract form
  const cred = (key.privateKey as { credential: { id: string; publicKey: PublicKey.PublicKey } }).credential;
  const credentialPublicKey = PublicKey.toHex(cred.publicKey);

  // 2. provision the Ithaca account server-side (mint+delegate throwaway EOA, authorize this key)
  const res = await fetch("/api/passkey/provision", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId: cred.id, key: serialized }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "provisioning failed");

  return { address: body.account, credentialId: cred.id, credentialPublicKey, label };
}

/** Passkey-sign an ERC-7821 batch; returns executionData ready to relay. */
async function signExecution(session: PasskeySession, calls: Call[]): Promise<Hex> {
  const { digest, nonce } = await accountDigest(session.address, calls);
  const key = Key.fromWebAuthnP256({
    credential: { id: session.credentialId, publicKey: PublicKey.fromHex(session.credentialPublicKey) },
    rpId: rpId(),
  });
  const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as Hex;
  return packExecutionData(calls, nonce, wrapped);
}

/** Sign an ERC-7821 batch with the passkey (Porto Key.sign) and relay it via ENGYE. */
export async function signAndRelay(session: PasskeySession, calls: Call[]): Promise<Hex> {
  const executionData = await signExecution(session, calls);

  const res = await fetch("/api/passkey/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: session.address, executionData }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "relay failed");
  return body.hash as Hex;
}

/** Pay an open quote from the passkey account. Discovers payTo+amount from the execute 402
 *  (x402-native discovery — no broker-address env in the client); server re-validates everything. */
export async function payForQuote(session: PasskeySession, quoteId: string): Promise<Hex> {
  const probe = await fetch(`/api/broker/execute/${quoteId}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (probe.status !== 402) throw new Error(`expected 402 requirements, got ${probe.status}`);
  const reqs = JSON.parse(atob(probe.headers.get("payment-required")!)).accepts[0];
  const calls: Call[] = [{
    to: USDC, value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [reqs.payTo as `0x${string}`, BigInt(reqs.amount)] }),
  }];
  const executionData = await signExecution(session, calls);
  const res = await fetch("/api/passkey/pay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quote_id: quoteId, account: session.address, executionData }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "passkey payment failed");
  return body.hash as Hex;
}
