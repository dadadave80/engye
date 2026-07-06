"use client";
// Provider registration — handoff .card + .field form. Probes the endpoint (expects a well-formed
// 402), pays one real call, and the validator scores a starting reputation via /api/registry.
import { useState } from "react";

export function RegisterForm() {
  const [form, setForm] = useState({ name: "", endpoint_url: "", price_usdc: "", wallet_address: "", capabilities: "", agent_id: "" });
  const [state, setState] = useState<"idle" | "probing" | "ok" | "fail">("idle");
  const [message, setMessage] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("probing"); setMessage("");
    try {
      const res = await fetch("/api/registry", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name, endpoint_url: form.endpoint_url,
          price_usdc: Number(form.price_usdc), wallet_address: form.wallet_address,
          capabilities: form.capabilities.split(",").map((s) => s.trim()).filter(Boolean),
          ...(form.agent_id.trim() ? { agent_id: Number(form.agent_id) } : {}),
        }),
      });
      const body = await res.json();
      if (res.ok) { setState("ok"); setMessage(`Probe paid and validated (score ${body.probe_score}) — you're live in the registry.`); }
      else { setState("fail"); setMessage(body.detail ?? body.error ?? "Registration failed."); }
    } catch (err) {
      setState("fail"); setMessage(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <div className="card">
      <h3>Register a provider</h3>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="p-name">Name</label>
          <input type="text" id="p-name" placeholder="hermes-relay" value={form.name} onChange={set("name")} required />
        </div>
        <div className="field">
          <label htmlFor="p-endpoint">Endpoint URL</label>
          <input type="url" id="p-endpoint" className="input-mono" placeholder="https://api.you.dev/task" value={form.endpoint_url} onChange={set("endpoint_url")} required />
          <p className="hint">Must answer <span className="mono">402 Payment Required</span> before doing work — we probe it.</p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-price">Price</label>
            <div className="input-suffix">
              <input type="number" id="p-price" step="0.001" min="0.001" placeholder="0.010" value={form.price_usdc} onChange={set("price_usdc")} required />
              <span className="suffix">USDC</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-wallet">Wallet</label>
            <input type="text" id="p-wallet" className="input-mono" placeholder="0x8f3C…" value={form.wallet_address} onChange={set("wallet_address")} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-caps">Capabilities</label>
          <input type="text" id="p-caps" placeholder="summarize, extract, translate" value={form.capabilities} onChange={set("capabilities")} />
        </div>
        <div className="field">
          <label htmlFor="p-agent">ERC-8004 Agent ID</label>
          <input type="text" id="p-agent" className="input-mono" placeholder="845020 (optional)" value={form.agent_id} onChange={set("agent_id")} />
          <p className="hint">Optional — verified on-chain: the wallet must be the agent&apos;s owner.</p>
        </div>
        <button className="btn btn-primary" type="submit" disabled={state === "probing"} aria-disabled={state === "probing"}>
          {state === "probing" ? "Probing…" : "Probe & register"}
        </button>
        {state === "ok" && <p className="hint" style={{ color: "var(--pass)" }}>{message}</p>}
        {state === "fail" && <p className="hint" style={{ color: "var(--slash)" }}>{message}</p>}
        {state === "idle" && <p className="hint">The probe pays your price once and validates the exchange. Pass, and paying demand starts.</p>}
      </form>
    </div>
  );
}
