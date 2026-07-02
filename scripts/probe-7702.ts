// Does Arc testnet accept EIP-7702 (type-4) transactions?
// Send a fully-signed type-4 tx from an UNFUNDED key:
//   "insufficient funds"  -> node parsed type 4 => 7702 SUPPORTED
//   "type not supported"  -> 7702 blocked on Arc
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const pk = process.env.BROKER_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC) });

const auth = await account.signAuthorization({
  contractAddress: "0x0000000000000000000000000000000000000001",
  chainId: arcTestnet.id,
  nonce: 1,
});

const signed = await account.signTransaction({
  type: "eip7702",
  chainId: arcTestnet.id,
  nonce: 0,
  gas: 100_000n,
  maxFeePerGas: 200_000_000_000n, // generous; never mined anyway (no funds)
  maxPriorityFeePerGas: 1_000_000_000n,
  to: account.address,
  value: 0n,
  authorizationList: [auth],
});

try {
  const hash = await pub.sendRawTransaction({ serializedTransaction: signed });
  console.log("UNEXPECTEDLY ACCEPTED:", hash);
} catch (e: any) {
  const msg = e?.details ?? e?.shortMessage ?? e?.message ?? String(e);
  console.log("node response:", msg.slice(0, 300));
}
