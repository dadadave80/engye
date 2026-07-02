// On-chain proof of the PORTO-based passkey path (headless WebAuthn key, no browser):
//   provision (mint+delegate throwaway EOA, authorize Porto Key) → Porto Key.sign a [approve,
//   stake] ERC-7821 intent → ENGYE relays → verify ProviderStake.stakes(account) increased.
// Uses the exact Porto Key module the browser uses; only createHeadless vs create differs.
// Run: bun scripts/passkey-e2e.ts
import { createPublicClient, http, encodeFunctionData, erc20Abi } from "viem";
import { arcTestnet } from "viem/chains";
import * as Key from "porto/viem/Key";
import { provisionPasskeyAccount, relayPasskeyExecute } from "../lib/passkeyAccount";
import { accountDigest, packExecutionData, type Call } from "../lib/ithaca";
import { PROVIDER_STAKE, providerStakeAbi } from "../lib/clientChain";

const USDC = process.env.USDC_ADDRESS as `0x${string}`;
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });
const tx = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

// 1. Porto headless WebAuthn key (software P-256 — same Key module the browser uses)
const key = Key.createHeadlessWebAuthnP256();
const serialized = Key.serialize(key);
const credentialId = `porto-e2e-${serialized.publicKey.slice(2, 18)}`;

console.log("1/5 provisioning passkey account (Porto Key)…");
const account = await provisionPasskeyAccount({ ...serialized }, credentialId);
const code = await pub.getCode({ address: account });
console.log(`    account ${account} delegated=${code?.slice(0, 8) === "0xef0100"}`);

// 2. stake intent: approve + stake 0.25 USDC (provision sponsors 1 USDC)
const amount = 250_000n;
const calls: Call[] = [
  { to: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PROVIDER_STAKE, amount] }) },
  { to: PROVIDER_STAKE, value: 0n, data: encodeFunctionData({ abi: providerStakeAbi, functionName: "stake", args: [amount] }) },
];
const { digest, nonce } = await accountDigest(account, calls);

// 3. Porto Key.sign the raw ERC-7821 digest (wrap = keyHash+prehash)
const wrapped = (await Key.sign(key, { address: null, payload: digest, wrap: true })) as `0x${string}`;
const executionData = packExecutionData(calls, nonce, wrapped);
console.log("2/5 Porto-signed intent built ✓");

// 4. relay through ENGYE
console.log("3/5 relaying…");
const hash = await relayPasskeyExecute(account, executionData);
console.log(`    ${tx(hash)}`);

// 5. verify
const staked = await pub.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [account] });
console.log(`4/5 ProviderStake.stakes(account) = ${Number(staked) / 1e6} USDC`);
if (staked !== amount) throw new Error(`expected ${Number(amount) / 1e6} staked, got ${Number(staked) / 1e6}`);
console.log("5/5 PORTO PASSKEY E2E: PASSED — provisioned, Porto-Key-signed, relayed, staked on Arc.");
