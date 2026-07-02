"use client";
// Passkey connect + sign, built on Porto's Key module (the official client for the
// ithacaxyz/account contract we deployed). Create a WebAuthn key, provision an Ithaca account
// for it (server), and sign ERC-7821 intents with Porto's Key.sign → ENGYE self-relays.
import * as Key from "porto/viem/Key";
import * as PublicKey from "ox/PublicKey";
import type { Hex } from "viem";
import { accountDigest, packExecutionData, type Call } from "@/lib/ithaca";
import type { PasskeySession } from "./passkey";

const rpId = () => (typeof window !== "undefined" ? window.location.hostname : "engye.vercel.app");

export async function connectPasskey(): Promise<PasskeySession | null> {
  if (typeof window === "undefined") throw new Error("passkey requires a browser");
  const cached = localStorage.getItem("engye.passkey");
  if (cached) return JSON.parse(cached) as PasskeySession;

  // 1. create the WebAuthn passkey (Porto/ox handles the credential + P-256 key)
  const key = await Key.createWebAuthnP256({ label: "ENGYE", rpId: rpId() });
  const serialized = Key.serialize(key); // { expiry, isSuperAdmin, keyType, publicKey } — contract form
  const credentialPublicKey = PublicKey.toHex((key.privateKey as { credential: { publicKey: PublicKey.PublicKey } }).credential.publicKey);
  const credentialId = (key.privateKey as { credential: { id: string } }).credential.id;

  // 2. provision the Ithaca account server-side (mint+delegate throwaway EOA, authorize this key)
  const res = await fetch("/api/passkey/provision", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId, key: serialized }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "provisioning failed");

  const session: PasskeySession = { address: body.account, credentialId, credentialPublicKey };
  localStorage.setItem("engye.passkey", JSON.stringify(session));
  return session;
}

/** Sign an ERC-7821 batch with the passkey (Porto Key.sign) and relay it via ENGYE. */
export async function signAndRelay(session: PasskeySession, calls: Call[]): Promise<Hex> {
  const { digest, nonce } = await accountDigest(session.address, calls);
  const key = Key.fromWebAuthnP256({
    credential: { id: session.credentialId, publicKey: PublicKey.fromHex(session.credentialPublicKey) },
    rpId: rpId(),
  });
  // address:null → sign the raw ERC-7821 digest (execute path, not ERC-1271); wrap = keyHash+prehash
  const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as Hex;
  const executionData = packExecutionData(calls, nonce, wrapped);

  const res = await fetch("/api/passkey/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: session.address, executionData }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "relay failed");
  return body.hash as Hex;
}
