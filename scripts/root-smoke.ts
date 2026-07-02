// Runs AFTER the human re-delegates root to IthacaAccount and authorizes the session key.
// Proves on Arc (not just in forge):
//   A. the session key executes an intent through the root account (0.1 USDC root→session)
//   B. a WebAuthn P256 passkey (software passkey via WebCrypto) is authorized by the
//      session key and then signs its own intent — full Solady WebAuthn verify on-chain.
// Run: bun scripts/root-smoke.ts
import { createPublicClient, http, parseEther, formatEther, encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { createHash } from "node:crypto";
import {
  rootExecute,
  rootExecuteWrapped,
  rootDigest,
  authorizeKeyOnRoot,
  keyHashOf,
  KeyType,
  type IthacaKey,
} from "../lib/ithaca";

const ROOT = process.env.ROOT_ADDRESS as Address;
const ITHACA = (process.env.ITHACA_IMPL ?? "").toLowerCase();
const session = privateKeyToAccount(process.env.SESSION_PRIVATE_KEY as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const tx = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

const code = ((await pub.getCode({ address: ROOT })) ?? "0x").toLowerCase();
if (code !== `0xef0100${ITHACA.slice(2)}`) {
  throw new Error(
    `root is not delegated to IthacaAccount yet (code=${code.slice(0, 20)}…). Run the cast --auth command first.`,
  );
}

// --- A. session-key intent ---
const before = await pub.getBalance({ address: session.address });
const hashA = await rootExecute([{ to: session.address, value: parseEther("0.1"), data: "0x" }]);
const after = await pub.getBalance({ address: session.address });
console.log(`A. session intent ✓ moved ${formatEther(after - before)} USDC root→session — ${tx(hashA)}`);

// --- B. software passkey (WebAuthn P256) ---
const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)); // 0x04||x||y
const x = BigInt("0x" + Buffer.from(rawPub.slice(1, 33)).toString("hex"));
const y = BigInt("0x" + Buffer.from(rawPub.slice(33, 65)).toString("hex"));
const passkey: IthacaKey = {
  expiry: 0,
  keyType: KeyType.WebAuthnP256,
  isSuperAdmin: true, // proof-of-capability; scoped keys + spend limits are the Phase 5 UI's job
  publicKey: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [x, y]),
};
const hashAuth = await authorizeKeyOnRoot(passkey);
console.log(`B1. passkey authorized on root by session key — ${tx(hashAuth)}`);

const calls = [{ to: session.address, value: parseEther("0.05"), data: "0x" as Hex }];
const { digest, nonce } = await rootDigest(calls);

// synthesize the WebAuthn assertion exactly as an authenticator would sign it
const challenge = Buffer.from(digest.slice(2), "hex"); // abi.encode(bytes32) == the 32 bytes
const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge.toString("base64url")}","origin":"https://engye.app"}`;
const authenticatorData = Buffer.concat([
  createHash("sha256").update("engye.app").digest(), // rpIdHash (any 32 bytes)
  Buffer.from([0x05]), // flags: UP | UV
  Buffer.from([0, 0, 0, 0]), // signCount
]);
const signBase = Buffer.concat([
  authenticatorData,
  createHash("sha256").update(clientDataJSON).digest(),
]);
// WebCrypto signs sha256(signBase) — exactly the WebAuthn message hash
const sigRaw = new Uint8Array(
  await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signBase),
);
let r = BigInt("0x" + Buffer.from(sigRaw.slice(0, 32)).toString("hex"));
let s = BigInt("0x" + Buffer.from(sigRaw.slice(32, 64)).toString("hex"));
if (s > P256_N / 2n) s = P256_N - s; // low-s normalization (solady rejects high s)

const innerSig = encodeAbiParameters(
  [
    {
      type: "tuple",
      components: [
        { name: "authenticatorData", type: "bytes" },
        { name: "clientDataJSON", type: "string" },
        { name: "challengeIndex", type: "uint256" },
        { name: "typeIndex", type: "uint256" },
        { name: "r", type: "bytes32" },
        { name: "s", type: "bytes32" },
      ],
    },
  ],
  [
    {
      authenticatorData: ("0x" + authenticatorData.toString("hex")) as Hex,
      clientDataJSON,
      challengeIndex: 23n,
      typeIndex: 1n,
      r: ("0x" + r.toString(16).padStart(64, "0")) as Hex,
      s: ("0x" + s.toString(16).padStart(64, "0")) as Hex,
    },
  ],
);
const wrapped = encodePacked(
  ["bytes", "bytes32", "uint8"],
  [innerSig, keyHashOf(passkey), 0],
);
const hashB = await rootExecuteWrapped(calls, nonce, wrapped);
console.log(`B2. PASSKEY-SIGNED intent executed on Arc ✓ — ${tx(hashB)}`);
console.log("\nroot account model proven live: session key + WebAuthn passkey, both relay-free.");
