"use client";
// /agora — the watch-only floor (spec §6). Two sections sharing one realtime subscription:
// live matches inside their verdict window, and a feed of recent terminal verdicts.
// Realtime idiom copied verbatim from components/LiveFeed.tsx (inline browser client,
// postgres_changes on `matches`, re-hydrate via the joined select — payloads carry no joins).
import { useEffect, useState, memo } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Clock, ArrowRight, ExternalLink } from "lucide-react";
import { Card, Badge, Eyebrow, EmptyState } from "../ui/primitives";
import { txUrl } from "@/lib/supabase/public";
import { VERDICT_WINDOW_SECONDS } from "@/lib/economics";
import { shapeLive, shapeVerdict, type LiveMatch, type VerdictRow } from "./shape";

export type { LiveMatch, VerdictRow };

const LIVE_STATUSES = new Set(["awaiting_verdict", "validating", "settle_retry"]);

const DRAMA: Record<"PASS" | "SLASHED", string> = {
  PASS: "Bond released back to the broker.",
  SLASHED: "Slashed — requester paid price + bond + a cut of provider stake.",
};

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ ...mono, fontSize: 14, color: tone || "var(--foreground)" }}>{value}</span>
    </div>
  );
}

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
  const settling = dueMs == null || dueMs <= 0;
  const dp = peek(m.deliverable);
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card padding={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
            color: "var(--accent)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "2px 8px",
          }}>{m.task}</span>
          <span style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, ...mono, fontSize: 12.5,
            color: settling ? "var(--muted-foreground)" : "var(--ring)",
            background: "color-mix(in oklab, var(--gold) 12%, transparent)", borderRadius: 999, padding: "3px 9px",
          }}>
            <Clock size={12} color="currentColor" aria-hidden="true" />
            {settling ? "settling" : fmtClock(dueMs)}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{m.provider}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Metric label="Price" value={`${price} USDC`} />
          <Metric label="Bond" value={`${bond} USDC`} tone="var(--ring)" />
          <Metric label="ĉ" value={confidence} />
        </div>
        {dp && (
          <div style={{
            ...mono, fontSize: 12, lineHeight: 1.5, color: "var(--muted-foreground)",
            background: "var(--secondary)", borderRadius: "var(--radius)", padding: "8px 10px",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{dp}</div>
        )}
        <Link href={`/m/${m.match_key}`} style={{ color: "var(--link)", textDecoration: "none", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
          match page <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </Card>
    </div>
  );
}

// memoized: the feed doesn't depend on the 1s countdown tick that re-renders Floor, so a row only
// re-renders when its own data or fresh flag changes (LiveCards genuinely need the tick, so aren't memoized).
const VerdictRowView = memo(function VerdictRowView({ r, fresh }: { r: VerdictRow; fresh: boolean }) {
  const href = txUrl(r.tx);
  const cls = fresh
    ? (r.status === "SLASHED" ? "flash-slash" : "flash-pass")
    : "animate-in fade-in slide-in-from-top-2 duration-300";
  return (
    <div
      className={cls}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderBottom: "1px solid var(--border)" }}
    >
      <Badge status={r.status} />
      <span style={{ fontSize: 14, flex: 1, textWrap: "pretty" }}>
        {r.provider} · {r.task} — {DRAMA[r.status]}
      </span>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" title="View on Arcscan" aria-label="View on Arcscan" style={{ color: "var(--link)", display: "inline-flex", flexShrink: 0 }}>
          <ExternalLink size={14} />
        </a>
      )}
      <span style={{ ...mono, fontSize: 12, color: "var(--muted-foreground)", flexShrink: 0, minWidth: 44, textAlign: "right" }}>{rel(r.at)}</span>
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
