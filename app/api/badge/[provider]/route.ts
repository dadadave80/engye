// "Bonded by ENGYE" badge — an SVG a registered provider can embed. Shows live ĉ if known.
import { NextRequest, NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  let confidence: string | null = null;
  try {
    const sb = supabasePublic();
    const { data } = await sb.from("providers").select("passes,trials").eq("id", provider).maybeSingle();
    if (data) confidence = ((data.passes + 2) / (data.trials + 4)).toFixed(2);
  } catch { /* badge still renders without the number */ }

  const right = confidence ? `ĉ ${confidence}` : "verified";
  const rightW = right.length * 7 + 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${132 + rightW}" height="20" role="img" aria-label="Bonded by ENGYE">
  <rect width="132" height="20" fill="#191511"/>
  <rect x="132" width="${rightW}" height="20" fill="#A0421F"/>
  <g fill="#EDE7D8" font-family="Geist,Verdana,sans-serif" font-size="11">
    <text x="10" y="14">Bonded by ENGYE</text>
    <text x="${132 + 8}" y="14" font-family="Geist Mono,monospace">${right}</text>
  </g>
</svg>`;
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
  });
}
