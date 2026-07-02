// Provision a passkey-controlled Ithaca account (mint+delegate throwaway EOA, authorize passkey).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { provisionPasskeyAccount } from "@/lib/passkeyAccount";
import { limited } from "@/lib/ratelimit";

export const maxDuration = 60;

const schema = z.object({
  credentialId: z.string().min(8).max(512),
  pubKey: z.object({ x: z.string().regex(/^0x[0-9a-fA-F]+$/), y: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-provision", 5, 3_600_000); // each provisions 2 sponsored txs
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const account = await provisionPasskeyAccount(parsed.data.pubKey, parsed.data.credentialId);
    return NextResponse.json({ account });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[passkey/provision]", message);
    return NextResponse.json({ error: "provision failed", message }, { status: 500 });
  }
}
