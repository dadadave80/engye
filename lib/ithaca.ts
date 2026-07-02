// Session-key operations on the ROOT IthacaAccount (EIP-7702, relay-free):
// the agent's session EOA signs the ERC-7821 intent AND submits it as its own relayer.
// Encodings verified in contracts/test/IthacaRoot.t.sol against the real implementation:
//   executionData = abi.encode(calls, opData)
//   opData        = abi.encodePacked(uint256 nonce, wrappedSig)
//   wrappedSig    = abi.encodePacked(innerSig, bytes32 keyHash, uint8 prehash=0)
//   keyHash       = keccak256(abi.encode(uint8 keyType, keccak256(publicKey)))
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const ERC7821_MODE =
  "0x0100000000007821000100000000000000000000000000000000000000000000" as Hex;

export enum KeyType {
  P256 = 0,
  WebAuthnP256 = 1,
  Secp256k1 = 2,
  External = 3,
}

export interface IthacaKey {
  expiry: number; // 0 = never
  keyType: KeyType;
  isSuperAdmin: boolean;
  publicKey: Hex; // Secp256k1: abi.encode(address) · (WebAuthn)P256: abi.encode(x, y)
}

export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

export const ithacaAbi = parseAbi([
  "function execute(bytes32 mode, bytes executionData) payable",
  "function computeDigest((address to,uint256 value,bytes data)[] calls, uint256 nonce) view returns (bytes32)",
  "function getNonce(uint192 seqKey) view returns (uint256)",
  "function authorize((uint40 expiry,uint8 keyType,bool isSuperAdmin,bytes publicKey) key) returns (bytes32)",
  "function revoke(bytes32 keyHash)",
]);

export const CALLS_PARAM = {
  type: "tuple[]",
  components: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const keyHashOf = (k: IthacaKey): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes32" }],
      [k.keyType, keccak256(k.publicKey)],
    ),
  );

export const sessionKeyFor = (sessionAddress: Address): IthacaKey => ({
  expiry: 0,
  keyType: KeyType.Secp256k1,
  isSuperAdmin: true,
  publicKey: encodeAbiParameters([{ type: "address" }], [sessionAddress]),
});

/** WebAuthn P-256 passkey as an Ithaca super-admin key. publicKey = abi.encode(x, y). */
export const passkeyKeyFor = (x: string, y: string): IthacaKey => ({
  expiry: 0,
  keyType: KeyType.WebAuthnP256,
  isSuperAdmin: true,
  publicKey: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(x), BigInt(y)]),
});

/** Read the current nonce + ERC-7821 digest for a call batch on any Ithaca account. */
export async function accountDigest(account: Address, calls: Call[]): Promise<{ digest: Hex; nonce: bigint }> {
  // server (scripts/API): personal RPC; browser: the public NEXT_PUBLIC RPC. Resilient — the
  // public RPC is flaky and viem's default 10s/thin-retry surfaced spurious "HTTP request failed".
  const transport = http(process.env.RPC || process.env.NEXT_PUBLIC_RPC_URL || undefined, { timeout: 20_000, retryCount: 3, retryDelay: 500 });
  const pub = createPublicClient({ chain: arcTestnet, transport });
  const nonce = await pub.readContract({ address: account, abi: ithacaAbi, functionName: "getNonce", args: [0n] });
  const digest = await pub.readContract({ address: account, abi: ithacaAbi, functionName: "computeDigest", args: [calls, nonce] });
  return { digest, nonce };
}

/** Pack a signed intent's executionData (calls + opData) for execute(MODE, executionData). */
export function packExecutionData(calls: Call[], nonce: bigint, wrappedSig: Hex): Hex {
  const opData = encodePacked(["uint256", "bytes"], [nonce, wrappedSig]);
  return encodeAbiParameters([CALLS_PARAM, { type: "bytes" }], [calls, opData]);
}

function env() {
  const root = process.env.ROOT_ADDRESS as Address;
  const pk = process.env.SESSION_PRIVATE_KEY as Hex;
  if (!root || !pk) throw new Error("ROOT_ADDRESS / SESSION_PRIVATE_KEY missing");
  const transport = http(process.env.RPC ?? undefined);
  const session = privateKeyToAccount(pk);
  return {
    root,
    session,
    pub: createPublicClient({ chain: arcTestnet, transport }),
    wallet: createWalletClient({ chain: arcTestnet, transport, account: session }),
  };
}

export async function rootDigest(calls: Call[]): Promise<{ digest: Hex; nonce: bigint }> {
  const { root, pub } = env();
  const nonce = await pub.readContract({
    address: root,
    abi: ithacaAbi,
    functionName: "getNonce",
    args: [0n],
  });
  const digest = await pub.readContract({
    address: root,
    abi: ithacaAbi,
    functionName: "computeDigest",
    args: [calls, nonce],
  });
  return { digest, nonce };
}

/** Submit an intent through the root account with a pre-built wrapped signature. */
export async function rootExecuteWrapped(calls: Call[], nonce: bigint, wrappedSig: Hex): Promise<Hex> {
  const { root, pub, wallet } = env();
  const opData = encodePacked(["uint256", "bytes"], [nonce, wrappedSig]);
  const executionData = encodeAbiParameters(
    [CALLS_PARAM, { type: "bytes" }],
    [calls, opData],
  );
  const hash = await wallet.writeContract({
    address: root,
    abi: ithacaAbi,
    functionName: "execute",
    args: [ERC7821_MODE, executionData],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`root execute reverted: ${hash}`);
  return hash;
}

/** Execute calls through the root account, signed by the agent's session key. */
export async function rootExecute(calls: Call[]): Promise<Hex> {
  const { session } = env();
  const { digest, nonce } = await rootDigest(calls);
  const innerSig = await session.sign({ hash: digest });
  const kh = keyHashOf(sessionKeyFor(session.address));
  const wrapped = encodePacked(["bytes", "bytes32", "uint8"], [innerSig, kh, 0]);
  return rootExecuteWrapped(calls, nonce, wrapped);
}

/** Authorize an additional key on the root (session key must already be a super admin). */
export async function authorizeKeyOnRoot(key: IthacaKey): Promise<Hex> {
  const { root } = env();
  const calldata = encodeFunctionData({
    abi: ithacaAbi,
    functionName: "authorize",
    args: [
      {
        expiry: key.expiry,
        keyType: key.keyType,
        isSuperAdmin: key.isSuperAdmin,
        publicKey: key.publicKey,
      },
    ],
  });
  return rootExecute([{ to: root, value: 0n, data: calldata }]);
}
