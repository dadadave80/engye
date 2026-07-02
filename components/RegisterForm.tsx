"use client";
import { useState } from "react";
import { Card, Button } from "./ui/primitives";

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelS: React.CSSProperties = { fontSize: 13, fontWeight: 500 };
const inputS: React.CSSProperties = { padding: "8px 10px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 14, fontFamily: "var(--font-body)" };
const hintS: React.CSSProperties = { fontSize: 12, color: "var(--muted-foreground)" };

export function RegisterForm() {
  const [form, setForm] = useState({ name: "", endpoint_url: "", price_usdc: "", wallet_address: "", capabilities: "" });
  const [state, setState] = useState<"idle" | "probing" | "ok" | "fail">("idle");
  const [message, setMessage] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setState("probing"); setMessage("");
    try {
      const res = await fetch("/api/registry", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name, endpoint_url: form.endpoint_url,
          price_usdc: Number(form.price_usdc), wallet_address: form.wallet_address,
          capabilities: form.capabilities.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const body = await res.json();
      if (res.ok) { setState("ok"); setMessage(`Probe paid and validated (score ${body.probe_score}) — you're live in the registry.`); }
      else { setState("fail"); setMessage(body.detail ?? body.error ?? "Registration failed."); }
    } catch (e) {
      setState("fail"); setMessage(e instanceof Error ? e.message : "Network error.");
    }
  }

  return (
    <Card stele padding={20}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={field}><label style={labelS}>Name</label><input style={inputS} placeholder="hermes-relay" value={form.name} onChange={set("name")} /></div>
        <div style={field}><label style={labelS}>Endpoint URL</label><input style={{ ...inputS, fontFamily: "var(--font-mono)" }} placeholder="https://api.example.com/task" value={form.endpoint_url} onChange={set("endpoint_url")} /><span style={hintS}>Must answer 402 with payment requirements.</span></div>
        <div style={field}><label style={labelS}>Price per task</label><input style={{ ...inputS, fontFamily: "var(--font-mono)" }} placeholder="0.05" value={form.price_usdc} onChange={set("price_usdc")} /><span style={hintS}>USDC</span></div>
        <div style={field}><label style={labelS}>Wallet</label><input style={{ ...inputS, fontFamily: "var(--font-mono)" }} placeholder="0x…" value={form.wallet_address} onChange={set("wallet_address")} /></div>
        <div style={{ ...field, gridColumn: "1 / -1" }}><label style={labelS}>Capabilities</label><input style={inputS} placeholder="summarization, question-answering" value={form.capabilities} onChange={set("capabilities")} /><span style={hintS}>Comma-separated.</span></div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button size="sm" onClick={submit} disabled={state === "probing"}>{state === "probing" ? "Probing…" : "Probe & register"}</Button>
        {state === "ok" && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
        {state === "fail" && <span style={{ fontSize: 13, color: "var(--oxblood-badge)" }}>{message}</span>}
      </div>
    </Card>
  );
}
