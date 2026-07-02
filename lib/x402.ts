// x402 over Circle Gateway Nanopayments (rail A) — seller + buyer.
// Pattern ported from reference/arc-nanopayments/lib/x402.ts + agent.mts.
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./db";

const NETWORK = `eip155:${process.env.ARC_CHAIN_ID ?? "5042002"}`;
const USDC = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET =
  process.env.GATEWAY_WALLET_ADDRESS ?? "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

// SDK v3 defaults to the PRODUCTION facilitator — Arc testnet needs the testnet URL explicitly
const facilitator = new BatchFacilitatorClient({
  url: process.env.FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com",
});

export type PaymentDirection = "inbound" | "outbound";

export function usdcToAtomic(usdc: number): string {
  return String(Math.round(usdc * 1_000_000));
}

export function buildRequirements(priceUsdc: number, payTo: string) {
  return {
    scheme: "exact" as const,
    network: NETWORK,
    asset: USDC,
    amount: usdcToAtomic(priceUsdc),
    payTo,
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET,
    },
  };
}

export function paymentRequired(
  endpoint: string,
  requirements: ReturnType<typeof buildRequirements>,
): NextResponse {
  const paymentRequiredHeader = {
    x402Version: 2,
    resource: {
      url: endpoint,
      description: `Paid resource (${Number(requirements.amount) / 1e6} USDC)`,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
  return new NextResponse(JSON.stringify({}), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequiredHeader)).toString("base64"),
    },
  });
}

export type SettleOutcome =
  | { ok: true; payer: string; transaction: string | null }
  | { ok: false; status: number; error: string };

/** Verify + settle a PAYMENT-SIGNATURE header against requirements, log to `payments`. */
export async function verifyAndSettle(
  req: NextRequest,
  requirements: ReturnType<typeof buildRequirements>,
  endpoint: string,
  direction: PaymentDirection,
  matchId?: string,
): Promise<SettleOutcome> {
  const paymentSignature = req.headers.get("payment-signature");
  if (!paymentSignature) return { ok: false, status: 402, error: "missing payment" };
  try {
    const payload = JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf-8"));
    const settleResult = await facilitator.settle(payload, requirements);
    if (!settleResult.success) {
      return { ok: false, status: 402, error: String(settleResult.errorReason ?? "settle failed") };
    }
    const payer = settleResult.payer ?? "unknown";
    await supabaseAdmin?.from("payments").insert({
      match_id: matchId ?? null,
      direction,
      endpoint,
      payer,
      amount_usdc: Number(requirements.amount) / 1e6,
      network: requirements.network,
      gateway_tx: settleResult.transaction ?? null,
      raw: { requirements, settleResult },
    });
    console.log(`[x402] settled ${endpoint}: ${Number(requirements.amount) / 1e6} USDC from ${payer}`);
    return { ok: true, payer, transaction: settleResult.transaction ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[x402] payment error on ${endpoint}:`, message);
    return { ok: false, status: 500, error: message };
  }
}

/** Wrap a route handler behind a fixed x402 price (plan §8 Phase 1). */
export function protectRoute(
  handler: (req: NextRequest) => Promise<NextResponse>,
  priceUsdc: number,
  endpoint: string,
  payTo: string,
  direction: PaymentDirection = "outbound",
) {
  return async (req: NextRequest) => {
    const requirements = buildRequirements(priceUsdc, payTo);
    if (!req.headers.get("payment-signature")) return paymentRequired(endpoint, requirements);
    const outcome = await verifyAndSettle(req, requirements, endpoint, direction);
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const response = await handler(req);
    response.headers.set(
      "PAYMENT-RESPONSE",
      Buffer.from(
        JSON.stringify({ success: true, transaction: outcome.transaction, network: NETWORK, payer: outcome.payer }),
      ).toString("base64"),
    );
    return response;
  };
}

// ---------------- buyer side ----------------

const clients = new Map<string, GatewayClient>();
function gatewayFor(privateKey: string): GatewayClient {
  let c = clients.get(privateKey);
  if (!c) {
    c = new GatewayClient({ chain: "arcTestnet", privateKey: privateKey as `0x${string}` });
    clients.set(privateKey, c);
  }
  return c;
}

export type PayInit = { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: string };

/** Read a 402's advertised price (USDC) without paying. */
export async function quotePrice(url: string, init?: PayInit): Promise<number> {
  const res = await fetch(url, { method: init?.method ?? "GET", body: init?.body });
  if (res.status !== 402) throw new Error(`expected 402 from ${url}, got ${res.status}`);
  const header = res.headers.get("payment-required");
  if (!header) throw new Error(`402 without PAYMENT-REQUIRED header from ${url}`);
  const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  const amount = Number(parsed?.accepts?.[0]?.amount);
  if (!Number.isFinite(amount)) throw new Error(`unparseable payment requirements from ${url}`);
  return amount / 1e6;
}

/**
 * Pay an x402 endpoint, refusing if it asks more than maxPriceUsdc (plan §11: caps everywhere).
 * Handles the 402 → sign (gasless EIP-3009) → retry handshake via GatewayClient.
 */
export async function payEndpoint(
  url: string,
  maxPriceUsdc: number,
  walletPrivateKey: string,
  init?: PayInit,
) {
  const price = await quotePrice(url, init);
  if (price > maxPriceUsdc) {
    throw new Error(`price ${price} USDC exceeds cap ${maxPriceUsdc} USDC for ${url}`);
  }
  const gateway = gatewayFor(walletPrivateKey);
  const result = await gateway.pay(url, { method: init?.method ?? "GET", body: init?.body });
  return { price, result };
}

/** Keep a wallet's Gateway balance funded enough to pay providers (auto-deposit like the sample). */
export async function ensureGatewayFloat(
  walletPrivateKey: string,
  minUsdc = 0.2,
  topUpUsdc = 1,
): Promise<void> {
  const gateway = gatewayFor(walletPrivateKey);
  const balances = await gateway.getBalances();
  if (balances.gateway.available >= BigInt(Math.round(minUsdc * 1e6))) return;
  if (balances.wallet.balance === 0n) {
    throw new Error("wallet has no USDC to deposit into Gateway");
  }
  await gateway.deposit(String(topUpUsdc));
}

export { gatewayFor };
