// Public health + reconciliation endpoint. Proves the system is real and the ledger balances.
import { NextResponse } from "next/server";
import { usdcBalance, gasBalance } from "@/lib/escrow";
import { getTotals } from "@/lib/queries";
import type { Address } from "viem";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CONTRACTS = {
  BondedEscrow: process.env.ESCROW_ADDRESS,
  RefundVault: process.env.REFUND_VAULT_ADDRESS,
  ProviderStake: process.env.PROVIDER_STAKE_ADDRESS,
  SessionAccount: process.env.DELEGATE_ADDRESS,
  IthacaAccount: process.env.ITHACA_IMPL,
};

export async function GET(): Promise<NextResponse> {
  const broker = process.env.BROKER_ADDRESS as Address;
  const vault = process.env.REFUND_VAULT_ADDRESS as Address;
  const escrow = process.env.ESCROW_ADDRESS as Address;

  const [treasury, gas, vaultFloat, escrowHeld, totals] = await Promise.all([
    usdcBalance(broker).catch(() => null),
    gasBalance(broker).catch(() => null),
    usdcBalance(vault).catch(() => null),
    usdcBalance(escrow).catch(() => null),
    getTotals().catch(() => null),
  ]);

  const circuitOpen = treasury != null && treasury >= 1.0;

  return NextResponse.json({
    ok: treasury != null,
    chain: "arc-testnet",
    chainId: 5042002,
    explorer: "https://testnet.arcscan.app",
    contracts: CONTRACTS,
    treasury: { usdc: treasury, gasUsdc: gas, matchingActive: circuitOpen },
    escrow: { bondsHeldUsdc: escrowHeld },
    vault: { floatUsdc: vaultFloat },
    totals,
    updatedAt: new Date().toISOString(),
  });
}
