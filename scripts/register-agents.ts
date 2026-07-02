// Post-funding: broker tops up provider + validator wallets with gas (native USDC, 18-dec view),
// then each wallet mints its ERC-8004 identity NFT on the canonical Arc testnet registry.
// Idempotent: skips roles whose AGENT_ID_* is already in .env.local.
// Run: bun scripts/register-agents.ts   (needs BROKER wallet faucet-funded)
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { registerAgent } from "../lib/erc8004";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
const envFile = readFileSync(envPath, "utf8");

const AGENTS: { role: string; pkVar: string; card: string }[] = [
  { role: "ENGYE", pkVar: "BROKER_PRIVATE_KEY", card: `${APP_URL}/.well-known/agent-card.json` },
  { role: "PROVIDER1", pkVar: "PROVIDER1_PRIVATE_KEY", card: `${APP_URL}/agents/inhouse-quote.json` },
  { role: "PROVIDER2", pkVar: "PROVIDER2_PRIVATE_KEY", card: `${APP_URL}/agents/inhouse-summarize.json` },
  { role: "PROVIDER3", pkVar: "PROVIDER3_PRIVATE_KEY", card: `${APP_URL}/agents/inhouse-flaky.json` },
  { role: "VALIDATOR", pkVar: "VALIDATOR_PRIVATE_KEY", card: `${APP_URL}/agents/validator.json` },
];

const transport = http(process.env.RPC ?? undefined);
const pub = createPublicClient({ chain: arcTestnet, transport });
const brokerAccount = privateKeyToAccount(process.env.BROKER_PRIVATE_KEY as `0x${string}`);
const broker = createWalletClient({ chain: arcTestnet, transport, account: brokerAccount });

// 1) gas top-up (gas on Arc IS USDC; native view is 18 decimals)
for (const a of AGENTS.slice(1)) {
  const address = privateKeyToAccount(process.env[a.pkVar] as `0x${string}`).address;
  const balance = await pub.getBalance({ address });
  if (balance >= parseEther("0.005")) continue;
  const hash = await broker.sendTransaction({ to: address, value: parseEther("0.02") });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`topped up ${a.role} (${address}) with 0.02 USDC gas — ${hash}`);
}

// 2) mint identities
let out = "";
for (const a of AGENTS) {
  if (envFile.includes(`AGENT_ID_${a.role}=`)) {
    console.log(`${a.role}: already registered, skipping`);
    continue;
  }
  const agentId = await registerAgent(process.env[a.pkVar]!, a.card);
  out += `AGENT_ID_${a.role}=${agentId}\n`;
  console.log(`${a.role}: ERC-8004 agentId ${agentId} — card ${a.card}`);
}
if (out) appendFileSync(envPath, `\n# ERC-8004 identity NFTs (canonical registry)\n${out}`);
