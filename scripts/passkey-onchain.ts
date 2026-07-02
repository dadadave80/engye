// Isolates the ON-CHAIN proof of the Porto-Key passkey path (no Supabase): mint+delegate a
// throwaway EOA, authorize a Porto WebAuthn Key, then Porto Key.sign a [approve,stake] intent
// and execute it — verifying our deployed IthacaAccount accepts Porto's wrapped signature.
// Run: bun scripts/passkey-onchain.ts
import { createPublicClient, createWalletClient, http, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import * as Key from "porto/viem/Key";
import { ithacaAbi, packExecutionData, ERC7821_MODE, type Call } from "../lib/ithaca";
import { PROVIDER_STAKE, providerStakeAbi } from "../lib/clientChain";

const ITHACA_IMPL = process.env.ITHACA_IMPL as `0x${string}`;
const USDC = process.env.USDC_ADDRESS as `0x${string}`;
const transport = http(process.env.RPC);
const pub = createPublicClient({ chain: arcTestnet, transport });
const relayer = createWalletClient({ account: privateKeyToAccount(process.env.BROKER_PRIVATE_KEY as Hex), chain: arcTestnet, transport });
const tx = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

// Porto headless WebAuthn key (software P-256 — same Key module the browser uses)
const key = Key.createHeadlessWebAuthnP256();
const serialized = Key.serialize(key);
const u = privateKeyToAccount(generatePrivateKey());
console.log(`account (throwaway EOA) = ${u.address}`);

// 1. delegate u → IthacaAccount
const authorization = await u.signAuthorization({ contractAddress: ITHACA_IMPL, chainId: arcTestnet.id, nonce: await pub.getTransactionCount({ address: u.address }) });
let hash = await relayer.sendTransaction({ to: u.address, value: 0n, data: "0x", authorizationList: [authorization] });
await pub.waitForTransactionReceipt({ hash });
console.log(`1/5 delegated: ${(await pub.getCode({ address: u.address }))?.slice(0, 8) === "0xef0100"}`);

// 2. authorize the Porto passkey key (signed by u's own key — raw-ECDSA root branch)
const aCalls: Call[] = [{ to: u.address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "authorize", args: [{ expiry: serialized.expiry, keyType: serialized.keyType, isSuperAdmin: serialized.isSuperAdmin, publicKey: serialized.publicKey }] }) }];
let nonce = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
let digest = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "computeDigest", args: [aCalls, nonce] });
hash = await relayer.writeContract({ address: u.address, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, packExecutionData(aCalls, nonce, await u.sign({ hash: digest }))] });
await pub.waitForTransactionReceipt({ hash });
console.log("2/5 passkey authorized as super-admin");

// 3. sponsor 1 USDC so the account can stake
hash = await relayer.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [u.address, 1_000000n] });
await pub.waitForTransactionReceipt({ hash });
console.log("3/5 sponsored 1 USDC");

// 4. Porto Key.sign a [approve, stake 0.25] batch and execute it
const amount = 250_000n;
const sCalls: Call[] = [
  { to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PROVIDER_STAKE, amount] }) },
  { to: PROVIDER_STAKE, value: 0n, data: encodeFunctionData({ abi: providerStakeAbi, functionName: "stake", args: [amount] }) },
];
nonce = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
digest = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "computeDigest", args: [sCalls, nonce] });
const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as Hex;
hash = await relayer.writeContract({ address: u.address, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, packExecutionData(sCalls, nonce, wrapped)] });
await pub.waitForTransactionReceipt({ hash });
console.log(`4/5 Porto-signed stake executed: ${tx(hash)}`);

// 5. verify
const staked = await pub.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [u.address] });
if (staked !== amount) throw new Error(`expected ${Number(amount) / 1e6}, got ${Number(staked) / 1e6}`);
console.log(`5/5 PORTO PASSKEY VERIFIED ON-CHAIN — stakes(account) = ${Number(staked) / 1e6} USDC. Our IthacaAccount accepts Porto's wrapped WebAuthn signature.`);
