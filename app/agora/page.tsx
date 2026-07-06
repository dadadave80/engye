// /agora — the watch-only floor (spec §6). Server-fetches the initial live set (matches
// currently inside their verdict window) and the recent terminal verdict feed; the client
// Floor takes it from there over one realtime subscription.
import { AppShell } from "@/components/AppShell";
import { Floor } from "@/components/agora/Floor";
import { shapeLive, shapeVerdict, type VerdictRow } from "@/components/agora/shape";
import { supabasePublic } from "@/lib/supabase/public";
import { getTotals } from "@/lib/queries";
import { IN_VERDICT_WINDOW, TERMINAL } from "@/lib/matchLifecycle";

export const dynamic = "force-dynamic";

const LIVE_SELECT = "id,match_key,status,verdict_due_at,price_usdc,bond_usdc,deliverable,quotes(task,confidence),providers(name)";
const VERDICT_SELECT = "id,match_key,status,settle_tx,bond_tx,settled_at,created_at,quotes(task),providers(name)";

export default async function AgoraPage() {
  const sb = supabasePublic();
  // the agora is the BONDED market — only matches with a bond on the line (unbonded best-effort
  // tasks have bond_usdc 0 and no bond_tx, so "bond released" copy would be wrong for them).
  const { data: liveRows } = await sb
    .from("matches").select(LIVE_SELECT)
    .in("status", [...IN_VERDICT_WINDOW])
    .gt("bond_usdc", 0)
    .order("verdict_due_at", { ascending: true });
  const { data: feedRows } = await sb
    .from("matches").select(VERDICT_SELECT)
    .in("status", [...TERMINAL])
    .gt("bond_usdc", 0)
    .order("settled_at", { ascending: false })
    .limit(15);
  const totals = await getTotals().catch(() => null);

  const initialLive = ((liveRows ?? []) as Record<string, any>[]).map(shapeLive);
  const initialFeed = ((feedRows ?? []) as Record<string, any>[])
    .map(shapeVerdict)
    .filter((r): r is VerdictRow => r !== null);

  return (
    <AppShell settled={totals?.matchesSettled ?? 0}>
      <div className="page-head">
        <p className="kicker">The Agora</p>
        <h1>Every verdict lands in public.</h1>
        <p className="lede">ENGYE&apos;s money is on the table below. The validator doesn&apos;t care whose.</p>
        <hr className="ledger-rule" />
      </div>
      <Floor initialLive={initialLive} initialFeed={initialFeed} />
    </AppShell>
  );
}
