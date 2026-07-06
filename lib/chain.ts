// The ONE adapter to Arc — every server-side read client, wallet client, and write-and-confirm
// lives here. Interface: arcPublic() / arcClients(pk) / sendTx(...). Implementation it hides:
// transport tuning, receipt polling, revert-assert. This is the single place a test fakes the chain.
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// Reads are idempotent → resilient transport (matches the hardening precedent in commit 5268e67).
// Arc mines ~1s; pollingInterval 1000 keeps receipt waits from idling 4s (precedent: 0aee44f).
const readTransport = () => http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 });

/** Read-only Arc client — no key required. */
export function arcPublic(): PublicClient {
  return createPublicClient({ chain: arcTestnet, transport: readTransport(), pollingInterval: 1_000 });
}

/** Read + write clients for a signer. Writes keep viem's default transport semantics. */
export function arcClients(pk: string) {
  const account = privateKeyToAccount(pk as Hex);
  return {
    account,
    pub: arcPublic(),
    wallet: createWalletClient({ chain: arcTestnet, transport: http(process.env.RPC ?? undefined), account }),
  };
}

/** Write → wait → assert-success → hash, for ANY contract. The only on-chain write path. */
export async function sendTx(opts: {
  pk: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  label?: string;
}): Promise<Hex> {
  const { pub, wallet, account } = arcClients(opts.pk);
  const hash = await wallet.writeContract({
    address: opts.address,
    abi: opts.abi,
    functionName: opts.functionName,
    args: opts.args as never,
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${opts.label ?? opts.functionName} reverted: ${hash}`);
  return hash;
}
