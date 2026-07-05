// Server: provision + relay for passkey-controlled Ithaca accounts (the research-verified path).
// Provisioning per new passkey user:
//   1. mint a throwaway EOA `u` — its address IS the user's account address
//   2. ENGYE relayer sponsors a type-4 tx delegating `u` → the deployed IthacaAccount impl
//   3. ENGYE relays an execute() intent SIGNED BY u's own key that authorizes the passkey as
//      a super-admin (the raw-ECDSA root branch: recover(digest,sig)==address(this))
//   4. DISCARD u's key (non-custodial — the passkey is the sole controller from here on)
// Then all future passkey-signed intents are relayed by ENGYE (users need no gas).
import {
  createPublicClient, createWalletClient, http, encodeFunctionData, erc20Abi,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { supabaseAdmin } from "./db";
import { ithacaAbi, packExecutionData, ERC7821_MODE, type Call } from "./ithaca";

/** Porto's serialized key (Key.serialize output) — the ithacaxyz/account Key struct. */
export interface SerializedKey { expiry: number; keyType: number; isSuperAdmin: boolean; publicKey: Hex }

const ITHACA_IMPL = process.env.ITHACA_IMPL as Address;
const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const DEMO_STAKE_SPONSOR = 250_000n; // 0.25 USDC so a fresh passkey user can try staking (testnet demo)

function relayer() {
  const pk = process.env.BROKER_PRIVATE_KEY as Hex;
  if (!pk) throw new Error("BROKER_PRIVATE_KEY (relayer) missing");
  const account = privateKeyToAccount(pk);
  // provisioning fires several sequential RPC calls; viem's default 10s/req timeout + thin retry
  // turned a single slow personal-RPC response into an opaque "HTTP request failed". Give it room.
  // retryCount 3/delay 200: enough to ride out a transient blip, but bounded (~1.4s worst case)
  // — retryCount 5 with backoff could stall ~18s on a flaky RPC. timeout 15s per attempt.
  const transport = http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 });
  return {
    account,
    // pollingInterval 1000 (not viem's 4000 default): Arc mines ~every 1s, so poll for receipts
    // at that cadence instead of waiting up to 4s to notice a mined tx.
    pub: createPublicClient({ chain: arcTestnet, transport, pollingInterval: 1000 }),
    wallet: createWalletClient({ chain: arcTestnet, transport, account }),
  };
}

export async function provisionPasskeyAccount(key: SerializedKey, credentialId: string): Promise<Address> {
  if (!supabaseAdmin) throw new Error("persistence unavailable");
  const { data: existing } = await supabaseAdmin.from("passkey_accounts").select("account").eq("credential_id", credentialId).maybeSingle();
  if (existing?.account) return existing.account as Address;

  const { pub, wallet } = relayer();
  const u = privateKeyToAccount(generatePrivateKey());

  // CLAIM before spending: the credential_id PK makes a concurrent duplicate lose here, pre-spend.
  const { error: claimErr } = await supabaseAdmin.from("passkey_accounts").insert({
    credential_id: credentialId, account: u.address.toLowerCase(), pub_x: key.publicKey.slice(0, 66), pub_y: "0x" + key.publicKey.slice(66),
  });
  if (claimErr) {
    // someone else is provisioning this credential (or already did) — do NOT spend; return the existing account
    const { data: won } = await supabaseAdmin.from("passkey_accounts").select("account").eq("credential_id", credentialId).maybeSingle();
    if (won?.account) return won.account as Address;
    throw new Error(`provision claim failed: ${claimErr.message}`);
  }

  try {
    // 1. delegate u → IthacaAccount (u authorizes; relayer submits + pays gas)
    const authNonce = await pub.getTransactionCount({ address: u.address });
    const authorization = await u.signAuthorization({ contractAddress: ITHACA_IMPL, chainId: arcTestnet.id, nonce: authNonce });
    const delegateHash = await wallet.sendTransaction({ to: u.address, value: 0n, data: "0x", authorizationList: [authorization] });
    await pub.waitForTransactionReceipt({ hash: delegateHash });

    // 2. authorize the passkey (Porto's serialized Key) as super-admin, signed by u (raw-ECDSA root branch)
    const authorizeKey = { expiry: key.expiry, keyType: key.keyType, isSuperAdmin: key.isSuperAdmin, publicKey: key.publicKey };
    const calls: Call[] = [{ to: u.address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "authorize", args: [authorizeKey] }) }];
    const nonce = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
    const digest = await pub.readContract({ address: u.address, abi: ithacaAbi, functionName: "computeDigest", args: [calls, nonce] });
    const sig = await u.sign({ hash: digest });
    const executionData = packExecutionData(calls, nonce, sig);
    const authorizeHash = await wallet.writeContract({ address: u.address, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, executionData] });
    await pub.waitForTransactionReceipt({ hash: authorizeHash });

    // 3. sponsor a little USDC so the demo stake works (the account, not gas, needs USDC to stake)
    try {
      const sponsorHash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [u.address, DEMO_STAKE_SPONSOR] });
      await pub.waitForTransactionReceipt({ hash: sponsorHash });
    } catch (e) {
      console.warn("[passkey] demo USDC sponsor skipped:", e instanceof Error ? e.message : e);
    }
  } catch (e) {
    // best-effort release so a genuine retry isn't deadlocked (same trade-off as app/api/passkey/pay/route.ts:90-96:
    // if the delegate tx actually landed, a retry re-delegates — accepted on testnet sub-cent amounts)
    await supabaseAdmin.from("passkey_accounts").delete().eq("credential_id", credentialId).eq("account", u.address.toLowerCase());
    throw e;
  }
  // u's key is discarded (non-custodial); the claim inserted above IS the persisted mapping
  return u.address;
}

/** Relay a passkey-signed intent (only for accounts we provisioned — don't sponsor arbitrary gas). */
export async function relayPasskeyExecute(account: Address, executionData: Hex): Promise<Hex> {
  if (!supabaseAdmin) throw new Error("persistence unavailable");
  const { data: known } = await supabaseAdmin.from("passkey_accounts").select("account").eq("account", account.toLowerCase()).maybeSingle();
  if (!known) throw new Error("unknown passkey account");
  const { pub, wallet } = relayer();
  // simulate first: reject a reverting intent before paying gas (re-adds the P256-verify simulation the
  // fixed-gas path skips for latency — worth it on an unauthenticated relay surface)
  await pub.simulateContract({ address: account, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, executionData], account: wallet.account });
  // fixed gas skips eth_estimateGas — expensive here because the node simulates the passkey's
  // P256 verify (~330k). 1.5M covers P256 verify + the batched calls with headroom.
  const hash = await wallet.writeContract({ address: account, abi: ithacaAbi, functionName: "execute", args: [ERC7821_MODE, executionData], gas: 1_500_000n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`relayed intent reverted: ${hash}`);
  return hash;
}
