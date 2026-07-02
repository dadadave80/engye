"use client";
// WebAuthn passkey → Ithaca account: connect (provision the real account server-side) and
// sign+relay ERC-7821 intents. Signature encoding cross-checked against contracts/test/
// IthacaRoot.t.sol::test_webauthn_passkey_intent and scripts/root-smoke.ts.
import { encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";
import { accountDigest, keyHashOf, passkeyKeyFor, packExecutionData, type Call } from "@/lib/ithaca";
import type { PasskeySession } from "./passkey";

const RP_NAME = "ENGYE";
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

const b64urlToBytes = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const bytesToB64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (b: Uint8Array): Hex => ("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
const bytesToBig = (b: Uint8Array) => BigInt(hex(b));
const to32 = (v: bigint): Hex => ("0x" + v.toString(16).padStart(64, "0")) as Hex;

/** Uncompressed P-256 SPKI ends with 0x04 || X(32) || Y(32). */
function pointFromSpki(spki: ArrayBuffer): { x: Hex; y: Hex } {
  const b = new Uint8Array(spki);
  const start = b.length - 65;
  return { x: hex(b.slice(start + 1, start + 33)), y: hex(b.slice(start + 33, start + 65)) };
}

/** Parse ASN.1 DER ECDSA (0x30 L 0x02 rl r 0x02 sl s), strip sign bytes, low-s normalize. */
function parseDerSig(der: Uint8Array): { r: bigint; s: bigint } {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error("bad DER");
  o++; // total length
  if (der[o++] !== 0x02) throw new Error("bad DER (r)");
  const rlen = der[o++]; const r = bytesToBig(der.slice(o, o + rlen)); o += rlen;
  if (der[o++] !== 0x02) throw new Error("bad DER (s)");
  const slen = der[o++]; let s = bytesToBig(der.slice(o, o + slen));
  if (s > P256_N / 2n) s = P256_N - s;
  return { r, s };
}

export async function connectPasskey(): Promise<PasskeySession | null> {
  if (typeof window === "undefined" || !("credentials" in navigator)) throw new Error("WebAuthn not available");
  const cached = localStorage.getItem("engye.passkey");
  if (cached) {
    const s = JSON.parse(cached) as PasskeySession;
    // re-assert presence, then reuse the provisioned account
    await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: b64urlToBytes(s.credentialId), type: "public-key" }], userVerification: "preferred", timeout: 60_000 },
    });
    return s;
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME, id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `engye-${Date.now()}`, displayName: "ENGYE user" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 / P-256
      authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;

  const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey();
  if (!spki) throw new Error("passkey did not expose a public key");
  const pubKey = pointFromSpki(spki);
  const credentialId = bytesToB64url(cred.rawId);

  // provision the real Ithaca account (mint+delegate throwaway EOA, authorize this passkey)
  const res = await fetch("/api/passkey/provision", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId, pubKey }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "provisioning failed");

  const session: PasskeySession = { address: body.account as Address, credentialId, pubKey };
  localStorage.setItem("engye.passkey", JSON.stringify(session));
  return session;
}

/** Sign an ERC-7821 batch with the passkey and relay it through ENGYE. Returns the tx hash. */
export async function signAndRelay(session: PasskeySession, calls: Call[]): Promise<Hex> {
  const account = session.address;
  const { digest, nonce } = await accountDigest(account, calls);

  // WebAuthn challenge = the raw 32 bytes of the digest (solady passes abi.encode(bytes32) == the bytes)
  const challenge = Uint8Array.from(digest.slice(2).match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: b64urlToBytes(session.credentialId), type: "public-key" }],
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential;
  const resp = assertion.response as AuthenticatorAssertionResponse;

  const authenticatorData = hex(new Uint8Array(resp.authenticatorData));
  const clientDataJSON = new TextDecoder().decode(resp.clientDataJSON);
  const challengeIndex = BigInt(clientDataJSON.indexOf('"challenge":'));
  const typeIndex = BigInt(clientDataJSON.indexOf('"type":'));
  const { r, s } = parseDerSig(new Uint8Array(resp.signature));

  const innerSig = encodeAbiParameters(
    [{
      type: "tuple",
      components: [
        { name: "authenticatorData", type: "bytes" }, { name: "clientDataJSON", type: "string" },
        { name: "challengeIndex", type: "uint256" }, { name: "typeIndex", type: "uint256" },
        { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
      ],
    }],
    [{ authenticatorData, clientDataJSON, challengeIndex, typeIndex, r: to32(r), s: to32(s) }],
  );
  const keyHash = keyHashOf(passkeyKeyFor(session.pubKey.x, session.pubKey.y));
  const wrapped = encodePacked(["bytes", "bytes32", "uint8"], [innerSig, keyHash, 0]);
  const executionData = packExecutionData(calls, nonce, wrapped);

  const res = await fetch("/api/passkey/relay", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, executionData }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? "relay failed");
  return body.hash as Hex;
}
