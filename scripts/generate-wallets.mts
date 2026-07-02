// Generate EOA wallets for broker treasury, demand agent, and 3 in-house providers.
// Idempotent: skips any role already present in .env.local. Run: bun scripts/generate-wallets.mts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

const roles = ["BROKER", "DEMAND", "PROVIDER1", "PROVIDER2", "PROVIDER3"];
let out = "";
for (const role of roles) {
  if (existing.includes(`${role}_ADDRESS=`)) {
    console.log(`${role}: already in .env.local, skipping`);
    continue;
  }
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  out += `${role}_ADDRESS=${account.address}\n${role}_PRIVATE_KEY=${pk}\n`;
  console.log(`${role}: ${account.address}`);
}
if (out) appendFileSync(envPath, `\n# generated wallets (testnet only)\n${out}`);
