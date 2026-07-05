"use client";
// Circle Modular Wallets — passkey-owned MSCA (ERC-4337 + ERC-6900) on Arc Testnet, gasless via
// Circle Gas Station. Replaces the hand-rolled Porto+IthacaAccount+self-relay stack: Circle owns
// the WebAuthn ceremony (register/login against a Console-registered passkey domain, so mobile
// biometrics work like id.porto.sh), account deployment (lazy, first userOp), relay (bundler), and
// gas (paymaster:true). Needs NEXT_PUBLIC_CLIENT_KEY + NEXT_PUBLIC_CLIENT_URL from the Circle Console.
import { createPublicClient, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { createBundlerClient, toWebAuthnAccount, type WebAuthnAccount } from "viem/account-abstraction";
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
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
