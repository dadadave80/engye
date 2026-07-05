// Passkey payment binding (Circle MSCA rail). The client pays the quote total to the broker via a
// gasless userOp (Gas Station), then binds the mined tx to the quote HERE. We validate post-hoc from
// the receipt: exactly a USDC Transfer(account → broker, exact total). The payments table's two
// partial-unique indexes make this race-safe: one inbound payment per quote (0006) AND one payment
// per gateway_tx (0004) — so a tx can't fund two quotes and a quote can't be paid twice.
// ponytail: post-hoc binding leaves a narrow same-amount front-run (an attacker who observes the
// mined tx could race to bind it to their own equal-priced quote, winning the gateway_tx unique
// claim). Testnet, sponsored sub-cent amounts → accepted; the airtight fix is prepare→sign→bind→send
// (bind the userOpHash before broadcast), added later once live-testable with the Circle bundler.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { supabaseAdmin } from "@/lib/db";
import { usdcAtomic } from "@/lib/escrow";
import { limited } from "@/lib/ratelimit";
import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const BROKER = process.env.BROKER_ADDRESS as Address;
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 }), pollingInterval: 1000 });

export const maxDuration = 60;

const schema = z.object({
  quote_id: z.string().uuid(),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

const isUniqueViolation = (e: { message?: string; code?: string } | null): boolean =>
  !!e && (e.code === "23505" || /duplicate key|already exists|unique/i.test(e.message ?? ""));

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-pay", 10, 60_000);
  if (rl) return rl;
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  const { quote_id, account, tx_hash } = parsed.data;

  const { data: quote } = await supabaseAdmin.from("quotes").select("id,status,expires_at,total_price_usdc").eq("id", quote_id).single();
  if (!quote) return NextResponse.json({ error: "quote not found" }, { status: 404 });
  if (quote.status !== "open") return NextResponse.json({ error: `quote is ${quote.status}` }, { status: 409 });
  const { data: prior } = await supabaseAdmin.from("payments").select("gateway_tx").eq("quote_id", quote_id).eq("direction", "inbound").maybeSingle();
  if (prior) return NextResponse.json({ error: "quote already has a payment", tx: prior.gateway_tx }, { status: 409 });

  const totalPriceUsdc = Number(quote.total_price_usdc);
  if (!Number.isFinite(totalPriceUsdc)) return NextResponse.json({ error: "quote has no price" }, { status: 500 });
  const expected = usdcAtomic(totalPriceUsdc);

  // validate the payment from the mined receipt: a USDC Transfer(account → broker, exact total)
  let receipt;
  try {
    receipt = await pub.getTransactionReceipt({ hash: tx_hash as Hex });
  } catch {
    return NextResponse.json({ error: "payment tx not found or not yet mined" }, { status: 400 });
  }
  if (receipt.status !== "success") return NextResponse.json({ error: "payment tx reverted" }, { status: 400 });
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const ok = transfers.some((l) =>
    l.address.toLowerCase() === USDC.toLowerCase() &&
    (l.args.from as string).toLowerCase() === account.toLowerCase() &&
    (l.args.to as string).toLowerCase() === BROKER.toLowerCase() &&
    l.args.value === expected);
  if (!ok) return NextResponse.json({ error: `tx did not transfer ${quote.total_price_usdc} USDC from this account to the broker` }, { status: 400 });

  // bind: one inbound payment per quote (0006) AND one per gateway_tx (0004) — a concurrent racer loses here
  const { error: bindErr } = await supabaseAdmin.from("payments").insert({
    direction: "inbound", endpoint: "/api/passkey/pay", payer: account.toLowerCase(),
    amount_usdc: totalPriceUsdc, network: `eip155:${arcTestnet.id}`, gateway_tx: tx_hash, quote_id,
    raw: { kind: "passkey_circle_userop" },
  });
  if (bindErr) {
    if (isUniqueViolation(bindErr)) return NextResponse.json({ error: "this payment is already bound (to this or another quote)" }, { status: 409 });
    return NextResponse.json({ error: `bind failed: ${bindErr.message}` }, { status: 500 });
  }
  return NextResponse.json({ hash: tx_hash });
}
