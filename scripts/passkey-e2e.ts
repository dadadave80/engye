// End-to-end proof of the passkey-account path WITHOUT a browser (software P-256 passkey):
//   provision (mint+delegate throwaway EOA, authorize passkey) → passkey-sign a [approve, stake]
//   ERC-7821 intent → ENGYE relays → verify ProviderStake.stakes(account) increased.
// Mirrors the browser flow's exact encodings. Run: bun scripts/passkey-e2e.ts
import { createPublicClient, http, encodeFunctionData, encodeAbiParameters, encodePacked, erc20Abi, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { createHash } from "node:crypto";
import { provisionPasskeyAccount, relayPasskeyExecute } from "../lib/passkeyAccount";
import { accountDigest, keyHashOf, passkeyKeyFor, packExecutionData, type Call } from "../lib/ithaca";
import { PROVIDER_STAKE, providerStakeAbi } from "../lib/clientChain";

const USDC = process.env.USDC_ADDRESS as `0x${string}`;
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });
const tx = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

// 1. software passkey (WebCrypto P-256)
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 0x04||x||y
const x = ("0x" + Buffer.from(raw.slice(1, 33)).toString("hex")) as Hex;
const y = ("0x" + Buffer.from(raw.slice(33, 65)).toString("hex")) as Hex;
const credentialId = `e2e-${Buffer.from(raw.slice(1, 9)).toString("hex")}`;

console.log("1/5 provisioning passkey account…");
const account = await provisionPasskeyAccount({ x, y }, credentialId);
const code = await pub.getCode({ address: account });
console.log(`    account ${account} delegated=${code?.slice(0, 8) === "0xef0100"}`);

// 2. build the stake intent: approve + stake 0.25 USDC (account was sponsored 1 USDC)
const amount = 250_000n;
const calls: Call[] = [
  { to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PROVIDER_STAKE, amount] }) },
  { to: PROVIDER_STAKE, value: 0n, data: encodeFunctionData({ abi: providerStakeAbi, functionName: "stake", args: [amount] }) },
];
const { digest, nonce } = await accountDigest(account, calls);

// 3. software-passkey sign the digest (WebAuthn assertion shape)
const challenge = Buffer.from(digest.slice(2), "hex");
const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge.toString("base64url")}","origin":"https://engye.vercel.app","crossOrigin":false}`;
const authenticatorData = Buffer.concat([createHash("sha256").update("engye.vercel.app").digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 0])]);
const signBase = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
const sigRaw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signBase));
let r = BigInt("0x" + Buffer.from(sigRaw.slice(0, 32)).toString("hex"));
let s = BigInt("0x" + Buffer.from(sigRaw.slice(32, 64)).toString("hex"));
if (s > P256_N / 2n) s = P256_N - s;
const to32 = (v: bigint): Hex => ("0x" + v.toString(16).padStart(64, "0")) as Hex;

const innerSig = encodeAbiParameters(
  [{ type: "tuple", components: [
    { name: "authenticatorData", type: "bytes" }, { name: "clientDataJSON", type: "string" },
    { name: "challengeIndex", type: "uint256" }, { name: "typeIndex", type: "uint256" },
    { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }] }],
  [{ authenticatorData: ("0x" + authenticatorData.toString("hex")) as Hex, clientDataJSON,
     challengeIndex: BigInt(clientDataJSON.indexOf('"challenge":')), typeIndex: BigInt(clientDataJSON.indexOf('"type":')),
     r: to32(r), s: to32(s) }],
);
const wrapped = encodePacked(["bytes", "bytes32", "uint8"], [innerSig, keyHashOf(passkeyKeyFor(x, y)), 0]);
const executionData = packExecutionData(calls, nonce, wrapped);
console.log("2/5 passkey-signed intent built ✓");

// 4. relay through ENGYE
console.log("3/5 relaying…");
const hash = await relayPasskeyExecute(account, executionData);
console.log(`    ${tx(hash)}`);

// 5. verify the stake landed
const staked = await pub.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [account] });
console.log(`4/5 ProviderStake.stakes(account) = ${Number(staked) / 1e6} USDC`);
if (staked !== amount) throw new Error(`expected ${Number(amount) / 1e6} staked, got ${Number(staked) / 1e6}`);
console.log("5/5 PASSKEY ACCOUNT E2E: PASSED — provisioned, passkey-signed, relayed, staked on Arc.");
