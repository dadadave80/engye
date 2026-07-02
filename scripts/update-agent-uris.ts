// Point the five ERC-8004 identity NFTs at the public APP_URL agent cards
// (registration used localhost). Each agent's own wallet signs its setAgentURI.
// Idempotent. Run: bun scripts/update-agent-uris.ts
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const APP = process.env.APP_URL ?? "https://engye.vercel.app";
const IDENTITY = (process.env.ERC8004_IDENTITY ?? "0x8004A818BFB912233c491871b3d84c89A494BD9e") as Address;
const abi = parseAbi([
  "function setAgentURI(uint256 agentId, string agentURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const AGENTS = [
  { idVar: "AGENT_ID_ENGYE", pkVar: "BROKER_PRIVATE_KEY", card: `${APP}/.well-known/agent-card.json` },
  { idVar: "AGENT_ID_PROVIDER1", pkVar: "PROVIDER1_PRIVATE_KEY", card: `${APP}/agents/inhouse-quote.json` },
  { idVar: "AGENT_ID_PROVIDER2", pkVar: "PROVIDER2_PRIVATE_KEY", card: `${APP}/agents/inhouse-summarize.json` },
  { idVar: "AGENT_ID_PROVIDER3", pkVar: "PROVIDER3_PRIVATE_KEY", card: `${APP}/agents/inhouse-flaky.json` },
  { idVar: "AGENT_ID_VALIDATOR", pkVar: "VALIDATOR_PRIVATE_KEY", card: `${APP}/agents/validator.json` },
] as const;

const transport = http(process.env.RPC ?? undefined);
const pub = createPublicClient({ chain: arcTestnet, transport });

for (const a of AGENTS) {
  const agentId = BigInt(process.env[a.idVar]!);
  const current = await pub.readContract({ address: IDENTITY, abi, functionName: "tokenURI", args: [agentId] });
  if (current === a.card) {
    console.log(`${a.idVar} (#${agentId}): already current ✓`);
    continue;
  }
  const account = privateKeyToAccount(process.env[a.pkVar] as Hex);
  const wallet = createWalletClient({ chain: arcTestnet, transport, account });
  const hash = await wallet.writeContract({ address: IDENTITY, abi, functionName: "setAgentURI", args: [agentId, a.card] });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`${a.idVar} (#${agentId}) → ${a.card} — ${hash}`);
}
