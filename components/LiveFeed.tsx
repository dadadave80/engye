"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Badge, AddressChip } from "./ui/primitives";
import { EmptyState } from "./ui/primitives";
import type { FeedRow } from "@/lib/queries";
import { toUiStatus } from "@/lib/queries";

const ARCSCAN = "https://testnet.arcscan.app";
const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

const rel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export function LiveFeed({ initial }: { initial: FeedRow[] }) {
  const [rows, setRows] = useState<FeedRow[]>(initial);
  const [freshId, setFreshId] = useState<string | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const ch = sb
      .channel("matches-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, async (payload) => {
        const m = payload.new as Record<string, any>;
        if (!m?.id) return;
        // hydrate provider + task (realtime payload lacks joins)
        const { data } = await sb.from("matches").select("id,created_at,status,bond_usdc,source,settle_tx,bond_tx,providers(name),quotes(task,confidence)").eq("id", m.id).single();
        if (!data) return;
        const d = data as Record<string, any>;
        const row: FeedRow = {
          id: d.id, created_at: d.created_at, task: d.quotes?.task?.type ?? "task",
          provider: d.providers?.name ?? "—", confidence: d.quotes?.confidence ?? null,
          bond: d.bond_usdc, status: toUiStatus(d.status), tx: d.settle_tx ?? d.bond_tx ?? null,
          source: d.source ?? "organic",
        };
        setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 40));
        setFreshId(row.id);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);

  if (rows.length === 0) {
    return <EmptyState title="The agora is quiet." description="The demand agent buys every few minutes — the first bonded match will appear here." />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={th}>Time</th><th style={th}>Task</th><th style={th}>Provider</th>
          <th style={th}>ĉ</th><th style={th}>Bond</th><th style={th}>Status</th><th style={th}>Tx</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === freshId ? "engye-row-in" : undefined}>
              <td style={{ ...td, color: "var(--muted-foreground)" }} title={r.created_at}>{rel(r.created_at)}</td>
              <td style={td}>{r.task}{r.source === "demand_agent" && <span style={{ ...mono, fontSize: 10, color: "var(--muted-foreground)", marginLeft: 6 }}>·demand</span>}</td>
              <td style={td}>{r.provider}</td>
              <td style={{ ...td, ...mono }}>{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
              <td style={{ ...td, ...mono }}>{r.bond != null ? Number(r.bond).toFixed(3) : "—"}</td>
              <td style={td}><Badge status={r.status} /></td>
              <td style={td}>{r.tx ? <AddressChip address={r.tx} href={`${ARCSCAN}/tx/${r.tx}`} /> : <span style={{ color: "var(--muted-foreground)" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
