// Demand agent — the full module: buy-cycle logic (runCycle), a CLI runner (runCli), and a read-only
// status read (demandStatus). Consumed by BOTH the GitHub cron / `demand:loop` (which invoke runCli
// and hold DEMAND_PRIVATE_KEY) and the eve demand subagent (agent/subagents/demand/, read-only). No
// loose agents/ entry file — the workflow calls `bun run demand` → runCli. Server-only.
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decide } from "./llm";
// NB: lib/x402 pulls in next/server + the Circle SDK, so it's imported DYNAMICALLY inside runCycle
// (below) rather than at the top — that keeps demandStatus and the eve subagent's status tool lean
// and free of those heavy server-only deps.

const APP = process.env.APP_URL ?? "https://engye.vercel.app";
export const DAILY_BUDGET = Number(process.env.DAILY_DEMAND_BUDGET ?? 2.0);

// lazy so importing this module never throws when the env isn't wired (e.g. a client bundle probe)
const sb = (): SupabaseClient => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const ledgerId = () => `demand:${new Date().toISOString().slice(0, 10)}`;

const TEMPLATES: Array<() => { type: string; spec: string; max_price_usdc: number }> = [
  () => ({
    type: "question-answering",
    spec: pick([
      "What is the boiling point of water at sea level in °C and °F?",
      "Name the four largest moons of Jupiter and who discovered them.",
      "What does HTTP status code 402 mean and where is it famously used?",
      "Explain in two sentences what a bonded escrow is.",
      "What is the capital of Australia, and why is it not Sydney?",
      "How many base pairs are in the human genome, roughly?",
    ]),
    max_price_usdc: 0.01,
  }),
  () => ({
    type: "summarization",
    spec: `Summarize in 2 bullet points: "${pick([
      "EIP-7702 lets an EOA set code via a signed authorization inside a type-4 transaction, effectively turning the account into a smart account while keeping its address and key.",
      "Circle Gateway batches many small offchain-signed USDC payment authorizations into single onchain settlements, making sub-cent payments economically viable.",
      "ERC-8004 defines identity, reputation, and validation registries so autonomous agents can build portable on-chain track records.",
    ])}"`,
    max_price_usdc: 0.01,
  }),
  () => ({
    type: "lookup",
    spec: pick([
      "In what year was the Rosetta Stone discovered, and where is it displayed today?",
      "What is the atomic number of tungsten and its chemical symbol?",
      "Which planet has the shortest day in the solar system?",
    ]),
    max_price_usdc: 0.002, // tight budget → cheap providers get demand too
  }),
];

const buySchema = z.object({ buy: z.boolean(), reason: z.string() });

export type CycleTask = { type: string; spec: string };
export type CycleOutcome =
  | { status: "declined"; detail: string; task: CycleTask }
  | { status: "skipped"; detail: string; task: CycleTask; price: number }
  | { status: "budget_exhausted"; detail: string; task: CycleTask; price: number }
  | { status: "bought"; detail: string; task: CycleTask; price: number; result: { status: string; verdict_due_at?: string } };

/** Run ONE autonomous buy cycle: draft task → quote → judge → atomic budget → pay/execute.
 *  Requires DEMAND_PRIVATE_KEY (signs the payment). Returns a structured outcome; logs each step. */
export async function runCycle(): Promise<CycleOutcome> {
  if (!process.env.DEMAND_PRIVATE_KEY) {
    throw new Error("DEMAND_PRIVATE_KEY isn't available in this runtime — live buy cycles run on the scheduled cron (GitHub Actions), which holds the demand signing key.");
  }
  const { payEndpoint, ensureGatewayFloat } = await import("./x402"); // heavy (next/server + Circle SDK) — load only when actually paying
  const supabase = sb();
  const task = pick(TEMPLATES)();
  const shortTask: CycleTask = { type: task.type, spec: task.spec };
  console.log(`task: [${task.type}] ${task.spec.slice(0, 80)}…`);

  const quoteRes = await fetch(`${APP}/api/broker/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, requester_wallet: process.env.DEMAND_ADDRESS }),
  });
  const quote = await quoteRes.json();
  if (quote.declined) {
    console.log(`broker declined: ${quote.reason}`);
    return { status: "declined", detail: quote.reason ?? "broker declined", task: shortTask };
  }

  // the agentic part: judge whether this quote is worth it
  const { data: ledger } = await supabase.from("budget_ledger").select("budget_usdc,spent_usdc").eq("id", ledgerId()).maybeSingle();
  const remaining = ledger ? Number(ledger.budget_usdc) - Number(ledger.spent_usdc) : DAILY_BUDGET;
  const judgment = await decide({
    role: "demand",
    system:
      "You are an autonomous buyer with a limited daily budget. Judge if this quote is worth buying. Be discerning: skip weak value, low broker confidence (<0.6), or prices that eat too much budget for what the task is worth. Strict JSON: {buy, reason}.",
    user: `Task: ${JSON.stringify(task)}\nQuote: total $${quote.total_price_usdc}, broker confidence ${quote.confidence}, bonded ${quote.action === "accept"}, reasoning: "${quote.reasoning_summary}"\nBudget remaining today: $${remaining.toFixed(4)} of $${DAILY_BUDGET}`,
    schema: buySchema,
  });
  await supabase.from("decisions").insert({
    kind: "demand_buy",
    quote_id: quote.quote_id,
    llm_provider: "groq",
    derived: { buy: judgment.data.buy, reason: judgment.data.reason, remaining },
    model: judgment.model,
    latency_ms: judgment.latencyMs,
  });
  if (!judgment.data.buy) {
    console.log(`skipped: ${judgment.data.reason}`);
    return { status: "skipped", detail: judgment.data.reason, task: shortTask, price: Number(quote.total_price_usdc) };
  }

  // atomic budget check-and-decrement — delayed/overlapping runs can never overspend
  const { data: ok, error } = await supabase.rpc("spend_budget", { p_id: ledgerId(), p_amount: quote.total_price_usdc, p_daily: DAILY_BUDGET });
  if (error) throw new Error(`budget rpc: ${error.message}`);
  if (!ok) {
    console.log("daily budget exhausted — skipping");
    return { status: "budget_exhausted", detail: "daily budget exhausted", task: shortTask, price: Number(quote.total_price_usdc) };
  }

  await ensureGatewayFloat(process.env.DEMAND_PRIVATE_KEY!, 0.05, 0.5);
  const { result } = await payEndpoint(
    `${APP}/api/broker/execute/${quote.quote_id}?source=demand_agent`,
    quote.total_price_usdc,
    process.env.DEMAND_PRIVATE_KEY!,
    { method: "POST", body: "{}" },
  );
  const d = result.data as { status: string; verdict_due_at?: string };
  console.log(`outcome: ${d.status}${d.verdict_due_at ? ` (verdict due ${d.verdict_due_at})` : ""} — paid $${quote.total_price_usdc}`);
  return { status: "bought", detail: `paid $${quote.total_price_usdc}`, task: shortTask, price: Number(quote.total_price_usdc), result: { status: d.status, verdict_due_at: d.verdict_due_at } };
}

/** CLI runner for the cron + local loop. One cycle by default, `cycles` N, or an infinite `loop`
 *  every 5 minutes. Lives here (not in a loose agents/ file) so the GitHub workflow + `demand:loop`
 *  invoke it directly: `bun -e "import('./lib/demand.ts').then(m => m.runCli())"`. */
export async function runCli(opts: { loop?: boolean; cycles?: number } = {}): Promise<void> {
  const onError = (e: unknown) => console.error("cycle error:", e instanceof Error ? e.message : e);
  if (opts.loop) {
    for (;;) {
      await runCycle().catch(onError);
      await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
    }
  }
  const cycles = opts.cycles ?? 1;
  for (let i = 0; i < cycles; i++) {
    await runCycle().catch((e) => { onError(e); process.exitCode = 1; });
  }
}

export interface DemandStatus {
  dayId: string;
  budget: number;
  spent: number;
  remaining: number;
  recent: Array<{ buy: boolean | null; reason: string | null; at: string }>;
}

/** Read-only view of the demand desk today: budget + the most recent buy/skip judgments. No key
 *  needed — safe to run anywhere the service-role Supabase key is present (incl. the eve runtime). */
export async function demandStatus(): Promise<DemandStatus> {
  const supabase = sb();
  const dayId = ledgerId();
  const { data: ledger } = await supabase.from("budget_ledger").select("budget_usdc,spent_usdc").eq("id", dayId).maybeSingle();
  const budget = ledger ? Number(ledger.budget_usdc) : DAILY_BUDGET;
  const spent = ledger ? Number(ledger.spent_usdc) : 0;
  const { data: recent } = await supabase
    .from("decisions").select("derived,created_at").eq("kind", "demand_buy")
    .order("created_at", { ascending: false }).limit(8);
  return {
    dayId, budget, spent, remaining: budget - spent,
    recent: (recent ?? []).map((r: { derived: { buy?: boolean; reason?: string } | null; created_at: string }) => ({
      buy: r.derived?.buy ?? null, reason: r.derived?.reason ?? null, at: r.created_at,
    })),
  };
}
