// Register a Circle-MSCA passkey account (execute's payer allow-list) + one-time USDC sponsor.
// The client derives the MSCA address from the passkey (Circle's SDK is browser-only — it can't run
// here, "window is not defined" — so we can't independently re-derive the address server-side).
// A bogus registration is harmless (the allow-list only gates who may PAY; a fake row can't act
// without a real on-chain payment FROM that address). The only drainable surface is the USDC
// sponsor, which registerPasskeyAccount bounds with a global daily cap on top of this 5/hr/IP limit.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerPasskeyAccount } from "@/lib/passkeyAccount";
import { limited } from "@/lib/ratelimit";
import type { Address, Hex } from "viem";

export const maxDuration = 60;

const schema = z.object({
  credentialId: z.string().min(8).max(512),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  publicKey: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-provision", 5, 3_600_000); // each may sponsor a little USDC
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const account = await registerPasskeyAccount({
      credentialId: parsed.data.credentialId,
      account: parsed.data.account as Address,
      publicKey: parsed.data.publicKey as Hex,
    });
    return NextResponse.json({ account });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[passkey/provision]", raw);
    const transient = /HTTP request failed|timed out|took too long|fetch failed|ECONN|socket/i.test(raw);
    const message = transient ? "Couldn't reach Arc just now — please try again in a moment." : raw;
    return NextResponse.json({ error: "register failed", message }, { status: 500 });
  }
}
