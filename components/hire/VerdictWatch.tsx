"use client";
// Live verdict bubble: countdown → realtime verdict from the matches row (spec §4.4).
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Badge } from "../ui/primitives";

const ARCSCAN = "https://testnet.arcscan.app";

export function VerdictWatch({ matchKey, dueAt, bondTx }: { matchKey: string; dueAt: string; bondTx?: string }) {
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
      const { data } = await sb.from("matches").select("status,settle_tx,refund_tx,stake_slash_tx").eq("match_key", matchKey).single();
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

  if (row) {
    const passed = row.status === "delivered";
    return (
      <div style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge status={passed ? "PASS" : "SLASHED"} />
        <span>{passed ? "validator passed it — bond released" : "validator rejected it — you were paid price + bond"}</span>
        {[["bond", bondTx], ["settle", row.settle_tx], ["refund", row.refund_tx], ["stake slash", row.stake_slash_tx]]
          .filter(([, tx]) => tx).map(([label, tx]) => (
            <a key={label as string} href={`${(tx as string).startsWith("http") ? tx : `${ARCSCAN}/tx/${tx}`}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>{label} ↗</a>
          ))}
        <a href={`/m/${matchKey}`} style={{ color: "var(--link)" }}>match page →</a>
      </div>
    );
  }
  return (
    <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
      verdict in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} — my validator rules publicly; watch at{" "}
      <a href={`/m/${matchKey}`} style={{ color: "var(--link)" }}>/m/{matchKey.slice(0, 10)}…</a>
      {left === 0 && " (any second now)"}
    </div>
  );
}
