"use client";
// Live verdict bubble: countdown → realtime verdict from the matches row (spec §4.4).
// Visuals adopted from design-system/import/market/VerdictWatch.jsx (counting / resolved).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@supabase/supabase-js";
import { Clock, ArrowRight } from "lucide-react";
import { Badge, AddressChip } from "../ui/primitives";

const ARCSCAN = "https://testnet.arcscan.app";
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const sum = (a: unknown, b: unknown) => (parseFloat(String(a ?? 0)) + parseFloat(String(b ?? 0))).toFixed(3);
const href = (tx: string) => (tx.startsWith("http") ? tx : `${ARCSCAN}/tx/${tx}`);

export function VerdictWatch({ matchKey, dueAt, bondTx }: { matchKey: string; dueAt: string; bondTx?: string }) {
  const total = useMemo(() => Math.max(1, Math.floor((Date.parse(dueAt) - Date.now()) / 1000)), [dueAt]);
  const [left, setLeft] = useState(() => Math.max(0, Math.floor((Date.parse(dueAt) - Date.now()) / 1000)));
  const [row, setRow] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.floor((Date.parse(dueAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [dueAt]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !anon) return;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const check = async () => {
      const { data } = await sb.from("matches").select("status,settle_tx,refund_tx,stake_slash_tx,price_usdc,bond_usdc").eq("match_key", matchKey).single();
      if (data && ["delivered", "failed_compensated"].includes(data.status)) setRow(data);
    };
    // subscribe FIRST, then check once the channel is live — otherwise a verdict landing in the gap
    // between an early check() and the subscription going live would be missed (stuck countdown).
    const ch = sb.channel(`verdict-${matchKey}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `match_key=eq.${matchKey}` },
        (p) => { const m = p.new as Record<string, any>; if (["delivered", "failed_compensated"].includes(m.status)) setRow(m); })
      .subscribe((status) => { if (status === "SUBSCRIBED") void check(); });
    return () => { sb.removeChannel(ch); };
  }, [matchKey]);

  const shell: CSSProperties = { border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 };

  if (row) {
    const passed = row.status === "delivered";
    const tint = passed ? "var(--laurel)" : "var(--oxblood)";
    const links = ([["bond", bondTx], ["settle", row.settle_tx], ["refund", row.refund_tx], ["stake slash", row.stake_slash_tx]] as const)
      .filter(([, tx]) => tx);
    return (
      <div className="animate-in fade-in zoom-in-95 duration-300" style={{ ...shell, borderColor: `color-mix(in oklab, ${tint} 40%, var(--border))` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Badge status={passed ? "PASS" : "SLASHED"} />
        </div>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, textWrap: "pretty" }}>
          {passed
            ? "Bond released — the broker kept its stake. The work passed the spec."
            : <>Slashed — you were paid <span style={{ ...mono, color: "var(--destructive)" }}>{sum(row.price_usdc, row.bond_usdc)} USDC</span> (price + bond), plus a cut of the provider&apos;s stake.</>}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, fontSize: 13, flexWrap: "wrap" }}>
          {links.map(([label, tx]) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
              <AddressChip address={tx as string} href={href(tx as string)} />
            </span>
          ))}
          <a href={`/m/${matchKey}`} style={{ color: "var(--link)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            match page <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
    );
  }

  const progress = total > 0 ? Math.max(0, left) / total : 0;
  return (
    <div className="animate-in fade-in duration-300" style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Clock size={16} color="var(--ring)" aria-hidden="true" />
        <span style={{ fontSize: 14, fontWeight: 500 }}>verdict in <span style={mono}>{fmt(left)}</span></span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)" }}>my validator rules publicly</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--secondary)", overflow: "hidden", marginTop: 12 }}>
        <div className="bar-fill" style={{ height: "100%", width: "100%", transformOrigin: "left center", transform: `scaleX(${progress})`, transition: "transform 1s linear", background: "var(--ring)" }} />
      </div>
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <a href={`/m/${matchKey}`} style={{ fontSize: 11, color: "var(--link)" }}>/m/{matchKey.slice(0, 10)}…{left === 0 ? " (any second now)" : ""}</a>
      </div>
    </div>
  );
}
