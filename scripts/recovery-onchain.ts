// On-chain proof of the RECOVERY flow the /account UI uses: a passkey (Porto Key) authorizes a
// backup wallet as a super-admin secp256k1 key on its Ithaca account, then revokes it. Verifies
// getKeys() reflects both. Mirrors useAccountActions.send (passkey-sign → relay) exactly.
// Run: bun scripts/recovery-onchain.ts
import { createPublicClient, createWalletClient, http, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import * as Key from "porto/viem/Key";
import { ithacaAbi, packExecutionData, ERC7821_MODE, sessionKeyFor, keyHashOf, KeyType, type Call } from "../lib/ithaca";
import { ithacaKeysAbi } from "../lib/clientChain";

const ITHACA_IMPL = process.env.ITHACA_IMPL as `0x${string}`;
const transport = http(process.env.RPC);
const pub = createPublicClient({ chain: arcTestnet, transport });
const relayer = createWalletClient({ account: privateKeyToAccount(process.env.BROKER_PRIVATE_KEY as Hex), chain: arcTestnet, transport });
const tx = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

const key = Key.createHeadlessWebAuthnP256();
const serialized = Key.serialize(key);
const u = privateKeyToAccount(generatePrivateKey());
console.log(`account = ${u.address}`);

// provision: delegate + authorize passkey (super-admin) — same as passkey provisioning
const authorization = await u.signAuthorization({ contractAddress: ITHACA_IMPL, chainId: arcTestnet.id, nonce: await pub.getTransactionCount({ address: u.address }) });
let hash = await relayer.sendTransaction({ to: u.address, value: 0n, data: "0x", authorizationList: [authorization] });
await pub.waitForTransactionReceipt({ hash });
const aCalls: Call[] = [{ to: u.address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "authorize", args: [{ expiry: serialized.expiry, keyType: serialized.keyType, isSuperAdmin: serialized.isSuperAdmin, publicKey: serialized.publicKey }] }) }];
const nonce = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
const digest = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "computeDigest", args: [aCalls, nonce] });
hash = await relayer.writeContract({ address: u.address, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, packExecutionData(aCalls, nonce, await u.sign({ hash: digest }))] });
await pub.waitForTransactionReceipt({ hash });
console.log("1/4 provisioned (passkey authorized) ✓");

// helper: passkey-sign a call batch and relay it (what useAccountActions.send does for passkey)
async function passkeyExec(calls: Call[]): Promise<void> {
  const n = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
  const d = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "computeDigest", args: [calls, n] });
  const wrapped = (await Key.sign(key, { address: null, payload: d, wrap: true })) as Hex;
  const h = await relayer.writeContract({ address: u.address, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, packExecutionData(calls, n, wrapped)] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`intent reverted: ${h}`);
  console.log(`    ${tx(h)}`);
}

// 2. ADD recovery wallet: passkey authorizes a backup EOA as super-admin secp256k1 key
const recovery = privateKeyToAccount(generatePrivateKey()).address;
const recoveryKey = sessionKeyFor(recovery);
const recoveryHash = keyHashOf(recoveryKey);
console.log(`2/4 adding recovery wallet ${recovery}…`);
await passkeyExec([{ to: u.address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "authorize", args: [recoveryKey] }) }]);

// verify getKeys now includes the recovery secp256k1 key
let [keys] = await pub.readContract({ address: u.address, abi: ithacaKeysAbi, functionName: "getKeys" });
const added = keys.find((k) => Number(k.keyType) === KeyType.Secp256k1);
if (!added) throw new Error("recovery key not found after authorize");
console.log(`3/4 recovery wallet authorized ✓ — ${keys.length} keys, incl. secp256k1 super-admin=${added.isSuperAdmin}`);

// 3. REVOKE it
console.log("4/4 revoking recovery wallet…");
await passkeyExec([{ to: u.address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "revoke", args: [recoveryHash] }) }]);
[keys] = await pub.readContract({ address: u.address, abi: ithacaKeysAbi, functionName: "getKeys" });
if (keys.some((k) => Number(k.keyType) === KeyType.Secp256k1)) throw new Error("recovery key still present after revoke");
console.log(`RECOVERY FLOW VERIFIED ON-CHAIN — add + revoke via passkey both work. ${keys.length} key(s) remain (the passkey).`);
