// Relay a passkey-signed ERC-7821 intent to the user's Ithaca account (ENGYE pays gas).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { relayPasskeyExecute } from "@/lib/passkeyAccount";
import { limited } from "@/lib/ratelimit";
import type { Address, Hex } from "viem";

export const maxDuration = 60;

const schema = z.object({
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  executionData: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-relay", 30, 60_000);
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const hash = await relayPasskeyExecute(parsed.data.account as Address, parsed.data.executionData as Hex);
    return NextResponse.json({ hash });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[passkey/relay]", message);
    return NextResponse.json({ error: "relay failed", message }, { status: 500 });
  }
}
