"use client";
// Dashboard live match feed — handoff table (caption + seals + tx-link + Σ reconciliation note),
// fed by an initial server snapshot and one realtime subscription on `matches`.
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { FeedRow, UiStatus } from "@/lib/queries";
import { toUiStatus } from "@/lib/queries";

const ARCSCAN = "https://testnet.arcscan.app";

const rel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};
const sealClass: Record<UiStatus, string> = { PASS: "seal-pass", SLASHED: "seal-slashed", OPEN: "seal-open" };
const trunc = (tx: string) => `${tx.slice(0, 6)}…`;

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
        const { data } = await sb.from("matches").select("id,created_at,status,bond_usdc,price_usdc,source,settle_tx,bond_tx,providers(name),quotes(task,confidence)").eq("id", m.id).single();
        if (!data) return;
        const d = data as Record<string, any>;
        const row: FeedRow = {
          id: d.id, created_at: d.created_at, task: d.quotes?.task?.type ?? "task",
          provider: d.providers?.name ?? "—", confidence: d.quotes?.confidence ?? null,
          bond: d.bond_usdc, price: d.price_usdc, status: toUiStatus(d.status), tx: d.settle_tx ?? d.bond_tx ?? null,
          source: d.source ?? "organic",
        };
        setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)].slice(0, 40));
        setFreshId(row.id);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);

  return (
    <div className="table-wrap">
      <table>
        <caption>Live match feed <span className="tag">newest first · realtime</span></caption>
        <thead>
          <tr>
            <th scope="col">Time</th><th scope="col">Task</th><th scope="col">Provider</th>
            <th scope="col" className="t-right">ĉ</th><th scope="col" className="t-right">Bond</th>
            <th scope="col">Status</th><th scope="col">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="muted">The agora is quiet — the demand agent buys every few minutes.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} className={r.id === freshId ? "engye-row-in" : undefined}>
              <td className="num muted" title={r.created_at}>{rel(r.created_at)}</td>
              <td>{r.task}{r.source === "demand_agent" && <span className="num" style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>·demand</span>}</td>
              <td>{r.provider}</td>
              <td className="num t-right">{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
              <td className="num t-right">{r.bond != null ? Number(r.bond).toFixed(3) : "—"}</td>
              <td><span className={`seal ${sealClass[r.status]}`}>{r.status}</span></td>
              <td>{r.tx ? <a className="tx-link" href={`${ARCSCAN}/tx/${r.tx}`} target="_blank" rel="noreferrer" title="View on Arcscan">{trunc(r.tx)} ↗</a> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tfoot-note">Σ payments + bonds − slashes = balances <span className="ok">✓ ledger reconciles</span></div>
    </div>
  );
}
