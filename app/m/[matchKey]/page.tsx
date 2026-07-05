// Public match permalink — this is the ERC-8004 requestURI target (${APP_URL}/m/<matchKey>),
// filed on-chain at validationRequest time. Server-fetches the initial row (with joins);
// MatchDetail takes over client-side for the countdown + realtime verdict flip.
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { supabasePublic } from "@/lib/supabase/public";
import { MatchDetail } from "@/components/m/MatchDetail";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ matchKey: string }> }) {
  const { matchKey } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(matchKey)) notFound();
  const sb = supabasePublic();
  const { data: m } = await sb
    .from("matches")
    .select("*, quotes(task,confidence,bond_usdc,total_price_usdc,reasoning), providers(name), validations(pass,score,reasons,model)")
    .eq("match_key", matchKey).maybeSingle();
  if (!m) notFound();
  return (
    <AppShell>
      <MatchDetail initial={m} matchKey={matchKey} />
    </AppShell>
  );
}
