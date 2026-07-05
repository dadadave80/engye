// Server: register a Circle-MSCA passkey account + sponsor a little USDC. Circle handles account
// deployment (lazy) + gas (Gas Station), so there's no mint/delegate/relay here anymore — we only
// (1) record the MSCA in passkey_accounts (the execute route's payer allow-list) and (2) transfer a
// small demo USDC float so a fresh user can pay a first task. Idempotent per account.
import { createPublicClient, createWalletClient, http, erc20Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { supabaseAdmin } from "./db";

const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const DEMO_SPONSOR = 250_000n; // 0.25 USDC so a fresh passkey user can pay a first task (testnet demo)
const DAILY_SPONSOR_CAP_USDC = 10; // hard bound on total sponsor drain/day (~40 accounts) — the real
// anti-drain control, since Circle's browser-only SDK can't re-derive the address server-side to verify it

function relayer() {
  const pk = process.env.BROKER_PRIVATE_KEY as Hex;
  if (!pk) throw new Error("BROKER_PRIVATE_KEY (sponsor) missing");
  const account = privateKeyToAccount(pk);
  const transport = http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 });
  return {
    account,
    pub: createPublicClient({ chain: arcTestnet, transport, pollingInterval: 1000 }),
    wallet: createWalletClient({ chain: arcTestnet, transport, account }),
  };
}

/** Record the passkey MSCA (idempotent) and one-time-sponsor a little USDC. Returns the account. */
export async function registerPasskeyAccount(opts: { credentialId: string; account: Address; publicKey: Hex }): Promise<Address> {
  if (!supabaseAdmin) throw new Error("persistence unavailable");
  const address = opts.account.toLowerCase();
  // idempotent by ACCOUNT (the MSCA is deterministic from the credential, so account↔credential is
  // 1:1) — so calling this again for an already-provisioned account (e.g. the payForQuote self-heal)
  // never re-inserts or re-sponsors, even if a different credential_id string is passed. limit(1)
  // (not maybeSingle) tolerates any legacy duplicate rows without throwing.
  const { data: existingRows } = await supabaseAdmin.from("passkey_accounts").select("account").eq("account", address).limit(1);
  if (existingRows && existingRows.length > 0) return opts.account;

  // CLAIM before spending: the credential_id PK makes a concurrent duplicate lose here, pre-sponsor.
  const { error: claimErr } = await supabaseAdmin.from("passkey_accounts").insert({
    credential_id: opts.credentialId, account: address,
    pub_x: opts.publicKey.slice(0, 66), pub_y: "0x" + opts.publicKey.slice(66),
  });
  if (claimErr) {
    const { data: won } = await supabaseAdmin.from("passkey_accounts").select("account").eq("credential_id", opts.credentialId).maybeSingle();
    if (won?.account) return won.account as Address;
    throw new Error(`register claim failed: ${claimErr.message}`);
  }

  // global daily sponsor budget: bounds total testnet USDC at risk regardless of attacker IPs (we
  // can't verify the address — Circle's SDK is browser-only). Registrations past the cap still
  // succeed; they just don't get the demo float. Count today's rows (this one included).
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabaseAdmin.from("passkey_accounts").select("*", { count: "exact", head: true }).gte("created_at", dayStart.toISOString());
  const spentTodayUsdc = (count ?? 1) * (Number(DEMO_SPONSOR) / 1e6);
  if (spentTodayUsdc > DAILY_SPONSOR_CAP_USDC) {
    console.warn(`[passkey] daily sponsor cap $${DAILY_SPONSOR_CAP_USDC} reached — registered ${address} without the demo float`);
    return opts.account;
  }

  // one-time USDC sponsor (best-effort — the account, not gas, needs USDC to pay a task; gas is on Gas Station)
  try {
    const { pub, wallet } = relayer();
    const hash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [opts.account, DEMO_SPONSOR] });
    await pub.waitForTransactionReceipt({ hash });
  } catch (e) {
    console.warn("[passkey] demo USDC sponsor skipped:", e instanceof Error ? e.message : e);
  }
  return opts.account;
}
