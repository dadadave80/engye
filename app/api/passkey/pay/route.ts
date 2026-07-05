// Relay-bound passkey payment (spec §5): the tx↔quote binding is created HERE, before the tx
// hash is public — closing rebind/race/spoof attacks a bare tx-hash proof would allow.
// The intent is validated (exactly one call: real-USDC transfer of the exact quote total to the
// broker) BEFORE relay; the Transfer log is re-checked on the receipt; the proof row is never deleted.
import { NextRequest, NextResponse } from "next/server";
import { decodeAbiParameters, decodeFunctionData, erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { supabaseAdmin } from "@/lib/db";
import { relayPasskeyExecute } from "@/lib/passkeyAccount";
import { CALLS_PARAM } from "@/lib/ithaca";
import { usdcAtomic } from "@/lib/escrow";
import { limited } from "@/lib/ratelimit";
import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

const USDC = (process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address;
const BROKER = process.env.BROKER_ADDRESS as Address;
const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.RPC ?? undefined, { timeout: 15_000, retryCount: 3, retryDelay: 200 }), pollingInterval: 1000 });

export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-pay", 10, 60_000);
  if (rl) return rl;
  if (!supabaseAdmin) return NextResponse.json({ error: "persistence unavailable" }, { status: 503 });
  const { quote_id, account, executionData } = await req.json().catch(() => ({}));
  if (!quote_id || !account || !executionData) return NextResponse.json({ error: "quote_id, account, executionData required" }, { status: 400 });

  const { data: quote } = await supabaseAdmin.from("quotes").select("id,status,expires_at,total_price_usdc,action").eq("id", quote_id).single();
  if (!quote) return NextResponse.json({ error: "quote not found" }, { status: 404 });
  if (quote.status !== "open") return NextResponse.json({ error: `quote is ${quote.status}` }, { status: 409 });
  if (new Date(quote.expires_at) < new Date()) return NextResponse.json({ error: "quote expired" }, { status: 410 });
  const { data: prior } = await supabaseAdmin.from("payments").select("id,gateway_tx").eq("quote_id", quote_id).eq("direction", "inbound").maybeSingle();
  if (prior) return NextResponse.json({ error: "quote already has a payment", tx: prior.gateway_tx }, { status: 409 });

  // validate the intent BEFORE relaying: exactly one call — real-USDC transfer(BROKER, exact total)
  const expected = usdcAtomic(Number(quote.total_price_usdc));
  let calls: readonly { to: Address; value: bigint; data: Hex }[];
  try {
    [calls] = decodeAbiParameters([CALLS_PARAM, { type: "bytes" }], executionData as Hex) as unknown as [typeof calls, Hex];
  } catch { return NextResponse.json({ error: "malformed executionData" }, { status: 400 }); }
  if (calls.length !== 1 || calls[0].to.toLowerCase() !== USDC.toLowerCase() || calls[0].value !== 0n) {
    return NextResponse.json({ error: "intent must be exactly one USDC transfer" }, { status: 400 });
  }
  let xfer: { to: Address; amount: bigint };
  try {
    const d = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    if (d.functionName !== "transfer") throw new Error("not transfer");
    xfer = { to: d.args[0] as Address, amount: d.args[1] as bigint };
  } catch { return NextResponse.json({ error: "calldata is not an ERC-20 transfer" }, { status: 400 }); }
  if (xfer.to.toLowerCase() !== BROKER.toLowerCase() || xfer.amount !== expected) {
    return NextResponse.json({ error: `transfer must send exactly ${quote.total_price_usdc} USDC to the broker` }, { status: 400 });
  }

  // relay (relayPasskeyExecute rejects unknown accounts), then belt-and-braces the Transfer log
  const hash = await relayPasskeyExecute(account as Address, executionData as Hex);
  const receipt = await pub.getTransactionReceipt({ hash });
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const ok = transfers.some((l) =>
    l.address.toLowerCase() === USDC.toLowerCase() &&
    (l.args.from as string).toLowerCase() === (account as string).toLowerCase() &&
    (l.args.to as string).toLowerCase() === BROKER.toLowerCase() &&
    l.args.value === expected);
  if (!ok) return NextResponse.json({ error: "relayed tx did not emit the expected USDC transfer", tx: hash }, { status: 500 });

  const { error } = await supabaseAdmin.from("payments").insert({
    direction: "inbound", endpoint: "/api/passkey/pay", payer: (account as string).toLowerCase(),
    amount_usdc: Number(quote.total_price_usdc), network: `eip155:${arcTestnet.id}`, gateway_tx: hash, quote_id,
    raw: { kind: "passkey_direct_transfer" },
  });
  if (error) return NextResponse.json({ error: `proof persist failed: ${error.message}`, tx: hash }, { status: 500 });
  return NextResponse.json({ hash });
}
