"use client";
// Circle Modular Wallets — passkey-owned MSCA (ERC-4337 + ERC-6900) on Arc Testnet, gasless via
// Circle Gas Station. Replaces the hand-rolled Porto+IthacaAccount+self-relay stack: Circle owns
// the WebAuthn ceremony (register/login against a Console-registered passkey domain, so mobile
// biometrics work like id.porto.sh), account deployment (lazy, first userOp), relay (bundler), and
// gas (paymaster:true). Needs NEXT_PUBLIC_CLIENT_KEY + NEXT_PUBLIC_CLIENT_URL from the Circle Console.
import { createPublicClient, type Address, type Hex, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { createBundlerClient, toWebAuthnAccount, type WebAuthnAccount } from "viem/account-abstraction";
import {
  WebAuthnMode,
  recoveryActions,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  walletClientToLocalAccount,
} from "@circle-fin/modular-wallets-core";

const CLIENT_KEY = process.env.NEXT_PUBLIC_CLIENT_KEY;
const CLIENT_URL = process.env.NEXT_PUBLIC_CLIENT_URL;

/** Persistable WebAuthn credential (strip the non-serializable `raw` PublicKeyCredential). */
export interface StoredCredential { id: string; publicKey: Hex; rpId?: string }

/** True when the Circle Console values are wired — the passkey option is disabled otherwise. */
export const circleConfigured = () => !!CLIENT_KEY && !!CLIENT_URL;

function requireConfig() {
  if (!CLIENT_KEY || !CLIENT_URL) throw new Error("Passkey sign-in isn't configured yet (CLIENT_KEY/CLIENT_URL).");
  return { clientKey: CLIENT_KEY, clientUrl: CLIENT_URL };
}

function clients() {
  const { clientKey, clientUrl } = requireConfig();
  const modular = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
  return {
    passkeyTransport: toPasskeyTransport(clientUrl, clientKey),
    public: createPublicClient({ chain: arcTestnet, transport: modular }),
    bundler: createBundlerClient({ chain: arcTestnet, transport: modular }),
  };
}

const strip = (c: { id: string; publicKey: Hex; rpId?: string }): StoredCredential => ({ id: c.id, publicKey: c.publicKey, rpId: c.rpId });

/** Register a NEW passkey (device biometrics via the Console-registered domain). */
export async function registerCredential(username: string): Promise<StoredCredential> {
  const { passkeyTransport } = clients();
  return strip(await toWebAuthnCredential({ transport: passkeyTransport, mode: WebAuthnMode.Register, username }));
}

/** Sign in with an EXISTING passkey (the browser/GPM shows the account picker). */
export async function loginCredential(): Promise<StoredCredential> {
  const { passkeyTransport } = clients();
  return strip(await toWebAuthnCredential({ transport: passkeyTransport, mode: WebAuthnMode.Login }));
}

/** Deterministic MSCA for a stored credential (view-only; no biometric prompt). */
export async function accountFromCredential(credential: StoredCredential) {
  const { public: client } = clients();
  const owner = toWebAuthnAccount({ credential: credential as unknown as Parameters<typeof toWebAuthnAccount>[0]["credential"] }) as WebAuthnAccount;
  return toCircleSmartAccount({ client, owner });
}

/** Send a batch of calls gaslessly (Gas Station paymaster); returns the mined tx hash. */
export async function sendCalls(credential: StoredCredential, calls: { to: Address; value: bigint; data: Hex }[]): Promise<Hex> {
  const { bundler } = clients();
  const account = await accountFromCredential(credential);
  let userOpHash: Hex;
  try {
    userOpHash = await bundler.sendUserOperation({ account, calls, paymaster: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // check balance FIRST — an "exceeds balance" revert also mentions the paymaster in the wrapped
    // userOp error, so a naive AA33/paymaster match would mislabel an unfunded account.
    if (/exceeds balance|insufficient (funds|balance)|transfer amount exceeds/i.test(msg))
      throw new Error("Your passkey account doesn't have enough USDC for this task yet — the first-task sponsor may still be landing; try again in a moment. " + msg);
    // AA33 = paymaster validation failed → almost always a missing/inactive Gas Station policy for Arc
    if (/\bAA33\b|paymaster (validation|deposit|balance)/i.test(msg))
      throw new Error("Gasless sponsorship is unavailable — the Circle Gas Station policy for Arc Testnet may not be active. " + msg);
    throw e;
  }
  const { receipt } = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
  if (receipt.status !== "success") throw new Error("user operation reverted");
  return receipt.transactionHash;
}

// ---------- Passkey recovery (Circle Modular Wallets recoveryActions) ----------
// SETUP (while the user still has the passkey): register an EOA WALLET OF THE USER'S CHOICE as a
// recovery owner on the MSCA — the passkey signs the registration; the chosen wallet just supplies
// its address. RESTORE (passkey lost): that same wallet signs `executeRecovery` to swap the account's
// owner to a fresh passkey. Both are gasless (Gas Station).

/** Turn an opaque userOp/bundler error into something a user can act on. */
function friendlyUserOpError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/\bAA33\b|paymaster (validation|deposit|balance)/i.test(msg))
    return new Error("Gasless sponsorship is unavailable — the Circle Gas Station policy for Arc Testnet may not be active. " + msg);
  if (/exceeds balance|insufficient (funds|balance)/i.test(msg))
    return new Error("Your passkey account doesn't have enough USDC for gas yet — try again in a moment. " + msg);
  return e instanceof Error ? e : new Error(msg);
}

/** The MSCA deploys lazily on its first OUTBOUND userOp — a received sponsor doesn't deploy it — so
 *  recovery registration on a brand-new account would hit a contract that doesn't exist yet. Deploy
 *  it first with a gasless no-op self-call if it has no code. */
async function ensureDeployed(credential: StoredCredential): Promise<void> {
  const { public: client } = clients();
  const account = await accountFromCredential(credential);
  const code = await client.getCode({ address: account.address });
  if (!code || code === "0x") {
    await sendCalls(credential, [{ to: account.address, value: 0n, data: "0x" }]);
  }
}

/** Register the recovery EOA on the passkey's MSCA (gasless). Returns the mined tx hash. */
export async function registerRecovery(credential: StoredCredential, recoveryAddress: Address): Promise<Hex> {
  try {
    await ensureDeployed(credential); // recovery registration needs the account contract to exist
    const { bundler } = clients();
    const recovery = bundler.extend(recoveryActions);
    const account = await accountFromCredential(credential);
    const userOpHash = await recovery.registerRecoveryAddress({ account, recoveryAddress, paymaster: true });
    const { receipt } = await recovery.waitForUserOperationReceipt({ hash: userOpHash });
    if (receipt.status !== "success") throw new Error("recovery registration reverted");
    return receipt.transactionHash;
  } catch (e) { throw friendlyUserOpError(e); }
}

/** Restore a lost passkey: mint a NEW passkey, then have the registered recovery WALLET sign the swap
 *  of the MSCA owner to it. `walletClient` is the connected recovery wallet (must have an account +
 *  Arc chain). Returns the new credential + the recovered account address. */
export async function recoverWithWallet(walletClient: WalletClient, username: string): Promise<{ credential: StoredCredential; address: Address }> {
  try {
    const { passkeyTransport, public: client, bundler } = clients();
    const recovery = bundler.extend(recoveryActions);
    // 1. mint a fresh passkey (device biometric)
    const fresh = await toWebAuthnCredential({ transport: passkeyTransport, mode: WebAuthnMode.Register, username });
    // 2. a temp MSCA owned by the recovery wallet — the signer that authorizes the swap
    const owner = walletClientToLocalAccount(walletClient);
    const tempAccount = await toCircleSmartAccount({ client, owner });
    // 3. swap the recovered account's owner to the new passkey
    const userOpHash = await recovery.executeRecovery({ account: tempAccount, credential: fresh, paymaster: true });
    const { receipt } = await recovery.waitForUserOperationReceipt({ hash: userOpHash });
    if (receipt.status !== "success") throw new Error("recovery execution reverted");
    // 4. the new passkey now controls the account — derive its address for the session
    const credential = strip(fresh);
    const account = await accountFromCredential(credential);
    return { credential, address: account.address };
  } catch (e) { throw friendlyUserOpError(e); }
}
