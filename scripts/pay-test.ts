// Phase 1 acceptance: one end-to-end gasless x402 payment on Arc testnet.
// Run: bun scripts/pay-test.ts   (Bun auto-loads .env.local; needs DEMAND wallet faucet-funded)
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { payEndpoint } from "../lib/x402";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const pk = process.env.DEMAND_PRIVATE_KEY;
if (!pk) throw new Error("DEMAND_PRIVATE_KEY missing from .env.local");

const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: pk as `0x${string}` });

const balances = await gateway.getBalances();
console.log("wallet:", balances.wallet.formatted, "USDC | gateway:", balances.gateway.formattedAvailable, "USDC");

if (balances.gateway.available < 100_000n) {
  if (balances.wallet.balance === 0n) {
    throw new Error(
      "DEMAND wallet is empty. Fund it at https://faucet.circle.com (Arc Testnet), then rerun.",
    );
  }
  console.log("depositing 0.5 USDC into Gateway…");
  const { depositTxHash } = await gateway.deposit("0.5");
  console.log("deposit tx:", `https://testnet.arcscan.app/tx/${depositTxHash}`);
}

const { price, result } = await payEndpoint(
  `${APP_URL}/api/inhouse/quote`,
  0.01, // cap — endpoint asks 0.001
  pk,
  { method: "POST", body: JSON.stringify({ type: "spike", spec: "prove the rail" }) },
);

console.log(
  `paid ${price} USDC — response:`,
  JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
const after = await gateway.getBalances();
console.log("gateway after:", after.gateway.formattedAvailable, "USDC");
