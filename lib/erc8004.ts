// Canonical ERC-8004 registries on Arc testnet (identity / reputation / validation).
// Function signatures verified against reference/erc-8004-contracts/abis/*.json.
// Per settled match (wired in the Phase 3 lifecycle):
//   broker  -> validationRequest(validator, providerAgentId, taskURI, matchKey)
//   validator wallet -> validationResponse(matchKey, score, "", deliverableHash, "pass"|"fail")
//   broker  -> giveFeedback(providerAgentId, score, ..., feedbackHash = matchKey)
// matchKey doubles as the BondedEscrow match_id — one bytes32 links escrow, validation, and reputation on-chain.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const IDENTITY = (process.env.ERC8004_IDENTITY ??
  "0x8004A818BFB912233c491871b3d84c89A494BD9e") as Address;
const REPUTATION = (process.env.ERC8004_REPUTATION ??
  "0x8004B663056A597Dffe9eCcC1965A193B7388713") as Address;
const VALIDATION = (process.env.ERC8004_VALIDATION ??
  "0x8004Cb1BF31DAf7788923b405b754f57acEB4272") as Address;

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

const validationAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
]);

function clientsFor(pk: string) {
  const account = privateKeyToAccount(pk as Hex);
  const transport = http(process.env.RPC ?? undefined);
  return {
    account,
    pub: createPublicClient({ chain: arcTestnet, transport }),
    wallet: createWalletClient({ chain: arcTestnet, transport, account }),
  };
}

export const contentHash = (s: string): Hex => keccak256(toBytes(s));

/** Mint an ERC-8004 identity NFT for a wallet; returns the agentId. */
export async function registerAgent(walletPk: string, agentURI: string): Promise<bigint> {
  const { pub, wallet, account } = clientsFor(walletPk);
  const { result, request } = await pub.simulateContract({
    address: IDENTITY,
    abi: identityAbi,
    functionName: "register",
    args: [agentURI],
    account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`registerAgent reverted: ${hash}`);
  return result;
}

/** Broker rates a provider agent after settlement (anti-self-dealing: provider NFTs are owned by provider wallets). */
export async function giveFeedback(opts: {
  providerAgentId: bigint;
  score: number; // 0..100
  passed: boolean;
  matchKey: Hex; // = BondedEscrow match_id
  feedbackURI?: string;
}): Promise<Hex> {
  const pk = process.env.BROKER_PRIVATE_KEY;
  if (!pk) throw new Error("BROKER_PRIVATE_KEY missing");
  const { pub, wallet, account } = clientsFor(pk);
  const hash = await wallet.writeContract({
    address: REPUTATION,
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [
      opts.providerAgentId,
      BigInt(Math.round(opts.score)),
      0,
      opts.passed ? "pass" : "fail",
      "engye-match",
      "",
      opts.feedbackURI ?? "",
      opts.matchKey,
    ],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`giveFeedback reverted: ${hash}`);
  return hash;
}

/** Called with the PROVIDER's own key — ERC-8004 only lets an agent's owner request
 *  validation for that agent ("Not authorized" otherwise, verified on Arc). */
export async function requestValidation(opts: {
  providerAgentId: bigint;
  requestURI: string;
  matchKey: Hex;
  providerPrivateKey: string;
}): Promise<Hex> {
  const pk = opts.providerPrivateKey;
  const validator = process.env.VALIDATOR_ADDRESS;
  if (!pk || !validator) throw new Error("provider key / VALIDATOR_ADDRESS missing");
  const { pub, wallet, account } = clientsFor(pk);
  const hash = await wallet.writeContract({
    address: VALIDATION,
    abi: validationAbi,
    functionName: "validationRequest",
    args: [validator as Address, opts.providerAgentId, opts.requestURI, opts.matchKey],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`validationRequest reverted: ${hash}`);
  return hash;
}

/** Validator agent posts its verdict on-chain (called with the VALIDATOR wallet). */
export async function respondValidation(opts: {
  matchKey: Hex;
  score: number; // 0..100
  deliverableHash: Hex;
  passed: boolean;
  responseURI?: string;
}): Promise<Hex> {
  const pk = process.env.VALIDATOR_PRIVATE_KEY;
  if (!pk) throw new Error("VALIDATOR_PRIVATE_KEY missing");
  const { pub, wallet, account } = clientsFor(pk);
  const hash = await wallet.writeContract({
    address: VALIDATION,
    abi: validationAbi,
    functionName: "validationResponse",
    args: [
      opts.matchKey,
      Math.max(0, Math.min(100, Math.round(opts.score))),
      opts.responseURI ?? "",
      opts.deliverableHash,
      opts.passed ? "pass" : "fail",
    ],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`validationResponse reverted: ${hash}`);
  return hash;
}

export async function getValidationStatus(matchKey: Hex) {
  const transport = http(process.env.RPC ?? undefined);
  const pub = createPublicClient({ chain: arcTestnet, transport });
  const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
    await pub.readContract({
      address: VALIDATION,
      abi: validationAbi,
      functionName: "getValidationStatus",
      args: [matchKey],
    });
  return { validatorAddress, agentId, response, responseHash, tag, lastUpdate };
}
