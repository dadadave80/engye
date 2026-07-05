"use client";
// /agora — the watch-only floor (spec §6). Two sections sharing one realtime subscription:
// live matches inside their verdict window, and a feed of recent terminal verdicts.
// Realtime idiom copied verbatim from components/LiveFeed.tsx (inline browser client,
// postgres_changes on `matches`, re-hydrate via the joined select — payloads carry no joins).
import { useEffect, useState, memo } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Card, Badge, Eyebrow, EmptyState } from "../ui/primitives";
import { txUrl } from "@/lib/supabase/public";
import { VERDICT_WINDOW_SECONDS } from "@/lib/economics";
import { shapeLive, shapeVerdict, type LiveMatch, type VerdictRow } from "./shape";

export type { LiveMatch, VerdictRow };

const LIVE_STATUSES = new Set(["awaiting_verdict", "validating", "settle_retry"]);

const STATUS_LABEL: Record<string, string> = {
  awaiting_verdict: "awaiting verdict",
  validating: "validating",
  settle_retry: "retrying settle",
};

const DRAMA: Record<"PASS" | "SLASHED", string> = {
  PASS: "bond released back to the broker",
  SLASHED: "slashed — requester paid price + bond + provider stake",
};

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", ...mono, fontSize: 13 };
const chip: React.CSSProperties = {
  ...mono, fontSize: 11, padding: "2px 8px", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", textTransform: "uppercase", letterSpacing: "0.06em",
};
const pre: React.CSSProperties = {
  ...mono, fontSize: 12, background: "var(--secondary)", padding: 10, borderRadius: "var(--radius)",
  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 96, overflow: "hidden",
};

const rel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const peek = (d: unknown): string | null => {
  if (d == null) return null;
  const s = typeof d === "string" ? d : JSON.stringify(d);
  if (!s) return null;
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

function LiveCard({ m, now }: { m: LiveMatch; now: number }) {
  const price = m.price_usdc != null ? Number(m.price_usdc).toFixed(4) : "—";
  const bond = m.bond_usdc != null ? Number(m.bond_usdc).toFixed(4) : "—";
  const confidence = m.confidence != null ? m.confidence.toFixed(2) : "—";
  const dueMs = m.verdict_due_at ? new Date(m.verdict_due_at).getTime() - now : null;
  const dueLabel = dueMs == null ? "—" : dueMs <= 0 ? "verdict any moment" : `verdict in ${fmtClock(dueMs)}`;
  const dp = peek(m.deliverable);
  return (
    <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={chip}>{m.task}</span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{STATUS_LABEL[m.status] ?? m.status}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{m.provider}</div>
      <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Price</span><span>{price} USDC</span></div>
      <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Bond</span><span>{bond} USDC</span></div>
      <div style={row}><span style={{ color: "var(--muted-foreground)" }}>ĉ</span><span>{confidence}</span></div>
      <div style={{ ...mono, fontSize: 12, color: dueMs != null && dueMs <= 0 ? "var(--gold-lifted)" : "var(--muted-foreground)" }}>{dueLabel}</div>
      {dp && <pre style={pre}>{dp}</pre>}
      <Link href={`/m/${m.match_key}`} style={{ fontSize: 13, color: "var(--link)", textDecoration: "none" }}>View match →</Link>
    </Card>
  );
}

// memoized: the feed doesn't depend on the 1s countdown tick that re-renders Floor, so a row only
// re-renders when its own data or fresh flag changes (LiveCards genuinely need the tick, so aren't memoized).
const VerdictRowView = memo(function VerdictRowView({ r, fresh }: { r: VerdictRow; fresh: boolean }) {
  const href = txUrl(r.tx);
  return (
    <div
      className={fresh ? "engye-row-in" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}
    >
      <Badge status={r.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{r.provider} · {r.task}</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{DRAMA[r.status]}</div>
      </div>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--link)", textDecoration: "none", whiteSpace: "nowrap" }}>
          Arcscan
        </a>
      )}
      <span style={{ fontSize: 12, color: "var(--muted-foreground)", ...mono, whiteSpace: "nowrap" }}>{rel(r.at)}</span>
    </div>
  );
});

export function Floor({ initialLive, initialFeed }: { initialLive: LiveMatch[]; initialFeed: VerdictRow[] }) {
  const [live, setLive] = useState<LiveMatch[]>(initialLive);
  const [feed, setFeed] = useState<VerdictRow[]>(initialFeed);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // shared countdown tick — one interval for every live card, not one per card
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const ch = sb
      .channel("agora-floor")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, async (payload) => {
        const m = payload.new as Record<string, any>;
        if (!m?.id) return;
        // hydrate provider + task + everything the cards/feed need (realtime payload lacks joins)
        const { data } = await sb
          .from("matches")
          .select("id,match_key,status,verdict_due_at,price_usdc,bond_usdc,deliverable,settle_tx,bond_tx,settled_at,created_at,providers(name),quotes(task,confidence)")
          .eq("id", m.id)
          .single();
        if (!data) return;
        const d = data as Record<string, any>;
        // the agora is the bonded market — never surface unbonded (best-effort) matches, and drop
        // any that somehow slipped in (their "bond released" copy would be wrong).
        if (!(Number(d.bond_usdc) > 0)) {
          setLive((prev) => prev.filter((r) => r.id !== d.id));
          setFeed((prev) => prev.filter((r) => r.id !== d.id));
          return;
        }
        if (LIVE_STATUSES.has(d.status)) {
          // route to the live grid
          setLive((prev) => [shapeLive(d), ...prev.filter((r) => r.id !== d.id)]);
          setFeed((prev) => prev.filter((r) => r.id !== d.id));
        } else {
          // left the verdict window — drop from the grid, and if terminal, land in the feed
          setLive((prev) => prev.filter((r) => r.id !== d.id));
          const v = shapeVerdict(d);
          if (v) {
            setFeed((prev) => [v, ...prev.filter((r) => r.id !== v.id)].slice(0, 40));
            setFreshId(v.id);
          }
        }
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>The Agora — every verdict lands in public</Eyebrow>
        <p style={{ fontSize: 15, maxWidth: 640, lineHeight: 1.5, margin: 0 }}>
          ENGYE&apos;s money is on the table below. The validator doesn&apos;t care whose.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>On the floor now</span>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            every accepted match gets a ~{Math.round(VERDICT_WINDOW_SECONDS / 60)}-minute verdict window before the bond moves
          </span>
        </div>
        {live.length === 0 ? (
          <EmptyState title="The floor is quiet." description="">
            <span style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              <code style={{ fontFamily: "var(--font-mono)" }}>bun run demand:loop</code> wakes it — or{" "}
              <Link href="/hire" style={{ color: "var(--link)", textDecoration: "none" }}>hire ENGYE yourself →</Link>
            </span>
          </EmptyState>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {live.map((m) => <LiveCard key={m.id} m={m} now={now} />)}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Verdicts</span>
        <Card padding={0}>
          {feed.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: "var(--muted-foreground)" }}>No verdicts yet — the agora is warming up.</div>
          ) : (
            feed.map((r) => <VerdictRowView key={r.id} r={r} fresh={r.id === freshId} />)
          )}
        </Card>
      </div>
    </div>
  );
}
