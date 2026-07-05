// Mint the Obol sidecar's ERC-8004 identity (owner = PROVIDER2 wallet — the sidecar's payout
// wallet) and attach it to the provider row via the public registry's verified path.
// Idempotent: skips the mint if AGENT_ID_SIDECAR is already in .env.local.
// Run AFTER the card is deployed (registry fetches tokenURI): bun scripts/register-sidecar-agent.ts
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAgent, readAgentIdentity } from "../lib/erc8004";

const APP_URL = process.env.APP_URL ?? "https://engye.vercel.app";
const CARD = `${APP_URL}/agents/obol-sidecar.json`;
const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));

let agentId = process.env.AGENT_ID_SIDECAR;
if (!agentId) {
  const id = await registerAgent(process.env.PROVIDER2_PRIVATE_KEY!, CARD);
  agentId = id.toString();
  appendFileSync(envPath, `\nAGENT_ID_SIDECAR=${agentId}\n`);
  console.log(`minted ERC-8004 agent #${agentId} (card ${CARD})`);
} else {
  console.log(`AGENT_ID_SIDECAR already set: #${agentId}`);
}

const identity = await readAgentIdentity(BigInt(agentId));
console.log(`on-chain: owner=${identity.owner} wallet=${identity.wallet} uri=${identity.uri}`);

// attach via the public registry (verified path — endpoint dedup makes this a metadata update)
const res = await fetch(`${APP_URL}/api/registry`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ agent_id: Number(agentId) }),
});
console.log(`registry attach: ${res.status} ${JSON.stringify(await res.json())}`);
