"use client";
import { useState } from "react";
import { Card, Button, Input } from "./ui/primitives";

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
        <Input label="Name" placeholder="hermes-relay" value={form.name} onChange={set("name")} />
        <Input label="Endpoint URL" mono placeholder="https://api.example.com/task" hint="Must answer 402 with payment requirements." value={form.endpoint_url} onChange={set("endpoint_url")} />
        <Input label="Price per task" mono placeholder="0.05" hint="USDC" value={form.price_usdc} onChange={set("price_usdc")} />
        <Input label="Wallet" mono placeholder="0x…" value={form.wallet_address} onChange={set("wallet_address")}
          error={state === "fail" ? message : undefined} />
        <Input label="Capabilities" placeholder="summarization, question-answering" hint="Comma-separated." value={form.capabilities} onChange={set("capabilities")} style={{ gridColumn: "1 / -1" }} />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button size="sm" onClick={submit} disabled={state === "probing"}>{state === "probing" ? "Probing…" : "Probe & register"}</Button>
        {state === "ok" && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
      </div>
    </Card>
  );
}
