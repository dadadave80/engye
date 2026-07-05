// Server-side Circle MSCA address derivation — verifies a client-claimed passkey account before we
// record it or sponsor USDC (anti fund-drain: never trust a client-supplied payout address). Mirrors
// the client's accountFromCredential deterministically from the WebAuthn public key.
import "server-only";
import { createPublicClient, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { toCircleSmartAccount, toModularTransport } from "@circle-fin/modular-wallets-core";

const CLIENT_KEY = process.env.NEXT_PUBLIC_CLIENT_KEY;
const CLIENT_URL = process.env.NEXT_PUBLIC_CLIENT_URL;

/** Deterministic MSCA address for a WebAuthn credential. Throws if Circle isn't configured. */
export async function deriveMscaAddress(credentialId: string, publicKey: Hex): Promise<Address> {
  if (!CLIENT_KEY || !CLIENT_URL) throw new Error("passkey wallet not configured");
  const client = createPublicClient({ chain: arcTestnet, transport: toModularTransport(`${CLIENT_URL}/arcTestnet`, CLIENT_KEY) });
  const owner = toWebAuthnAccount({ credential: { id: credentialId, publicKey } as unknown as Parameters<typeof toWebAuthnAccount>[0]["credential"] });
  const account = await toCircleSmartAccount({ client, owner });
  return account.address;
}
