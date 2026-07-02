// Verify the four Vyper contracts on Arcscan (Blockscout) — run after deploy.sh + env update.
// FINAL proven recipe (schema walked via the Phoenix websocket, see CLAUDE.md):
//   - curl multipart, field literally `files[0]` with `type=application/json`
//   - settings: NO evmVersion (whitelist knows neither "prague" nor "default"; vyper 0.4.3
//     default == prague), optimize as BOOLEAN (true == "gas"), flat outputSelection
//   - default codegen only — the verifier cannot express Venom (experimentalCodegen dropped)
// Run: bun scripts/verify-contracts.ts
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "https://testnet.arcscan.app/api/v2/smart-contracts";
const COMPILER = "v0.4.3+commit.bff19ea2";

const CONTRACTS = [
  { name: "BondedEscrow", envVar: "ESCROW_ADDRESS" },
  { name: "RefundVault", envVar: "REFUND_VAULT_ADDRESS" },
  { name: "ProviderStake", envVar: "PROVIDER_STAKE_ADDRESS" },
  { name: "SessionAccount", envVar: "DELEGATE_ADDRESS" },
] as const;

async function isVerified(address: string): Promise<boolean> {
  const body = await fetch(`${BASE}/${address}`).then((r) => r.json()).catch(() => ({}));
  return body?.is_verified === true;
}

for (const c of CONTRACTS) {
  const address = process.env[c.envVar]?.toLowerCase();
  if (!address) {
    console.log(`${c.name}: ${c.envVar} not set, skipping`);
    continue;
  }
  if (await isVerified(address)) {
    console.log(`${c.name}: already verified ✓`);
    continue;
  }
  const std = {
    language: "Vyper",
    sources: { [`src/${c.name}.vy`]: { content: readFileSync(`contracts/src/${c.name}.vy`, "utf8") } },
    interfaces: {},
    settings: { optimize: true, outputSelection: { "*": ["*"] } },
  };
  const tmp = `/tmp/verify-${c.name}.json`;
  writeFileSync(tmp, JSON.stringify(std));
  // multipart upload via curl (standard fetch+FormData also works — the historical verification
  // failures were NOT the multipart, they were Venom bytecode the verifier couldn't match, fixed
  // by shipping default-codegen; curl just keeps this script dependency-free of the Bun global).
  const out = execFileSync("curl", [
    "-s", "-X", "POST", `${BASE}/${address}/verification/via/vyper-standard-input`,
    "-F", `compiler_version=${COMPILER}`,
    "-F", "license_type=apache_2_0",
    "-F", `files[0]=@${tmp};type=application/json`,
  ], { encoding: "utf8" });
  console.log(`${c.name}: submitted — ${out.slice(0, 80)}`);
  let ok = false;
  for (let i = 0; i < 12 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    ok = await isVerified(address);
  }
  console.log(ok ? `${c.name}: VERIFIED ✓` : `${c.name}: NOT verified — rerun (transient 502s happen) or check via websocket`);
}
