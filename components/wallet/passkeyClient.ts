"use client";
// WebAuthn passkey creation/retrieval + P-256 public-key extraction, browser-side.
// Produces a PasskeySession the app can display and (in the passkey build step) use to sign
// ERC-7821 intents on an Ithaca smart account. The P256 verifier is live on Arc, and the
// wrapped-signature encoding is proven in scripts/root-smoke.ts + contracts/test/IthacaRoot.t.sol.
import { keccak256, encodeAbiParameters, getAddress, type Address } from "viem";
import type { PasskeySession } from "./passkey";

const RP_NAME = "ENGYE";
const b64urlToBytes = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const bytesToB64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** An uncompressed P-256 SPKI ends with 0x04 || X(32) || Y(32). Pull the trailing 65 bytes. */
function pointFromSpki(spki: ArrayBuffer): { x: string; y: string } {
  const b = new Uint8Array(spki);
  const marker = b.lastIndexOf(0x04, b.length - 65);
  const start = marker >= 0 && b.length - marker >= 65 ? marker : b.length - 65;
  return { x: hex(b.slice(start + 1, start + 33)), y: hex(b.slice(start + 33, start + 65)) };
}

/** Smart-account address the passkey controls (counterfactual: keccak(x,y) → 20 bytes).
 *  Deterministic + display-stable; the passkey build step swaps in the factory/deploy address. */
function accountAddress(x: string, y: string): Address {
  const h = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(x), BigInt(y)]));
  return getAddress("0x" + h.slice(-40));
}

export async function connectPasskey(): Promise<PasskeySession | null> {
  if (typeof window === "undefined" || !("credentials" in navigator)) {
    throw new Error("WebAuthn not available in this browser");
  }
  const existing = localStorage.getItem("engye.passkey");
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  if (existing) {
    const saved = JSON.parse(existing) as PasskeySession;
    // re-assert to prove presence, then reuse the stored account
    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: b64urlToBytes(saved.credentialId), type: "public-key" }],
        userVerification: "preferred",
        timeout: 60_000,
      },
    });
    return saved;
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: window.location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: `engye-${Date.now()}`,
        displayName: "ENGYE user",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 / P-256
      authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;

  const att = cred.response as AuthenticatorAttestationResponse;
  const spki = att.getPublicKey();
  if (!spki) throw new Error("passkey did not expose a public key");
  const { x, y } = pointFromSpki(spki);
  const session: PasskeySession = {
    address: accountAddress(x, y),
    credentialId: bytesToB64url(cred.rawId),
    pubKey: { x, y },
  };
  localStorage.setItem("engye.passkey", JSON.stringify(session));
  return session;
}
