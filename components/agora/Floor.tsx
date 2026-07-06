"use client";
// /agora — the watch-only floor (spec §6). Two sections sharing one realtime subscription:
// live matches inside their verdict window, and a feed of recent terminal verdicts.
// Skinned to the handoff: stamped seals, .verdicts list, .floor-empty quiet state.
import { IN_VERDICT_WINDOW } from "@/lib/matchLifecycle";
import { useEffect, useState, memo } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { txUrl } from "@/lib/supabase/public";
import { VERDICT_WINDOW_SECONDS } from "@/lib/economics";
import { shapeLive, shapeVerdict, type LiveMatch, type VerdictRow } from "./shape";

export type { LiveMatch, VerdictRow };

const LIVE_STATUSES = new Set<string>(IN_VERDICT_WINDOW);

const DRAMA: Record<"PASS" | "SLASHED", string> = {
  PASS: "bond released back to the broker.",
  SLASHED: "failed validation — requester paid price + bond + a cut of provider stake.",
};

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

const rel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const peek = (d: unknown): string | null => {
  if (d == null) return null;
  const s = typeof d === "string" ? d : JSON.stringify(d);
  if (!s) return null;
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

function LiveCard({ m, now }: { m: LiveMatch; now: number }) {
  const price = m.price_usdc != null ? Number(m.price_usdc).toFixed(3) : "—";
  const bond = m.bond_usdc != null ? Number(m.bond_usdc).toFixed(3) : "—";
  const confidence = m.confidence != null ? m.confidence.toFixed(2) : "—";
  const dueMs = m.verdict_due_at ? new Date(m.verdict_due_at).getTime() - now : null;
  const settling = dueMs == null || dueMs <= 0;
  const dp = peek(m.deliverable);
  return (
    <div className="card animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="caps" style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--accent-ink)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "2px 8px" }}>{m.task}</span>
        <span className="seal seal-open" style={{ marginLeft: "auto", ...mono, transform: "none", letterSpacing: "0.08em" }}>{settling ? "SETTLING" : fmtClock(dueMs!)}</span>
      </div>
      <div className="small muted">{m.provider}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {[["price", `${price} USDC`, "var(--ink)"], ["bond", `${bond} USDC`, "var(--accent-ink)"], ["ĉ", confidence, "var(--ink)"]].map(([l, v, c]) => (
          <div key={l} className="min-w-0" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="caps" style={{ fontSize: 10.5, color: "var(--muted)" }}>{l}</span>
            <span style={{ ...mono, fontSize: "var(--text-sm)", color: c, overflowWrap: "break-word" }}>{v}</span>
          </div>
        ))}
      </div>
      {dp && (
        <div style={{ ...mono, fontSize: "var(--text-xs)", lineHeight: 1.5, color: "var(--muted)", background: "var(--bg-raised)", borderRadius: "var(--radius-sm)", padding: "8px 10px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{dp}</div>
      )}
      <Link href={`/m/${m.match_key}`} className="tx-link">match page →</Link>
    </div>
  );
}

// memoized: the feed doesn't depend on the 1s countdown tick that re-renders Floor.
const VerdictRowView = memo(function VerdictRowView({ r, fresh }: { r: VerdictRow; fresh: boolean }) {
  const href = txUrl(r.tx);
  const trunc = r.tx ? `${r.tx.slice(0, 6)}…${r.tx.slice(-4)}` : null;
  return (
    <li className={fresh ? (r.status === "SLASHED" ? "flash-slash" : "flash-pass") : "animate-in fade-in slide-in-from-top-2 duration-300"}>
      <span className={`seal ${r.status === "SLASHED" ? "seal-slashed" : "seal-pass"}`}>{r.status}</span>
      <span className="what"><strong>{r.task}</strong> · {r.provider} — {DRAMA[r.status]}</span>
      {href && <a className="tx-link" href={href} target="_blank" rel="noreferrer" title="View on Arcscan">{trunc} ↗</a>}
      <span className="when">{rel(r.at)}</span>
    </li>
  );
});

export function Floor({ initialLive, initialFeed }: { initialLive: LiveMatch[]; initialFeed: VerdictRow[] }) {
  const [live, setLive] = useState<LiveMatch[]>(initialLive);
  const [feed, setFeed] = useState<VerdictRow[]>(initialFeed);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
        const { data } = await sb
          .from("matches")
          .select("id,match_key,status,verdict_due_at,price_usdc,bond_usdc,deliverable,settle_tx,bond_tx,settled_at,created_at,providers(name),quotes(task,confidence)")
          .eq("id", m.id)
          .single();
        if (!data) return;
        const d = data as Record<string, any>;
        if (!(Number(d.bond_usdc) > 0)) {
          setLive((prev) => prev.filter((r) => r.id !== d.id));
          setFeed((prev) => prev.filter((r) => r.id !== d.id));
          return;
        }
        if (LIVE_STATUSES.has(d.status)) {
          setLive((prev) => [shapeLive(d), ...prev.filter((r) => r.id !== d.id)]);
          setFeed((prev) => prev.filter((r) => r.id !== d.id));
        } else {
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
    <>
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-title">
          <h2>On the floor now</h2>
          <span className="tag">verdict window ≈ {Math.round(VERDICT_WINDOW_SECONDS / 60)} min</span>
        </div>
        {live.length === 0 ? (
          <div className="card floor-empty">
            <p className="quiet">The floor is quiet.</p>
            <p className="small">No bonds are awaiting verdict. Wake the market — send paying demand:</p>
            <pre className="code"><span className="k">bun run</span> demand:loop</pre>
            <p className="small muted" style={{ marginTop: 12 }}>
              or <Link href="/hire" className="tx-link">hire ENGYE yourself →</Link>
            </p>
          </div>
        ) : (
          <div className="r-card-grid">
            {live.map((m) => <LiveCard key={m.id} m={m} now={now} />)}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Verdicts</h2>
          <span className="tag">most recent first</span>
        </div>
        <div className="table-wrap">
          {feed.length === 0 ? (
            <div className="small muted" style={{ padding: "var(--space-4) var(--space-6)" }}>No verdicts yet — the agora is warming up.</div>
          ) : (
            <ul className="verdicts">
              {feed.map((r) => <VerdictRowView key={r.id} r={r} fresh={r.id === freshId} />)}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
