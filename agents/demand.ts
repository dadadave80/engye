// The demand agent — an autonomous buyer with a daily budget and its own judgment.
// Stateless cycle: draft task → quote → DECIDE if it's worth the price (a buyer that
// always buys is automation; this one declines) → budget check-and-decrement (atomic,
// overlapping runs can never overspend) → execute → exit.
// Run: bun agents/demand.ts [--cycles N] [--loop]
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { decide } from "../lib/llm";
import { payEndpoint, ensureGatewayFloat } from "../lib/x402";

const APP = process.env.APP_URL ?? "https://engye.vercel.app";
const DAILY_BUDGET = Number(process.env.DAILY_DEMAND_BUDGET ?? 2.0);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

const buySchema = z.object({ buy: z.boolean(), reason: z.string() });

async function cycle(): Promise<void> {
  const task = pick(TEMPLATES)();
  console.log(`task: [${task.type}] ${task.spec.slice(0, 80)}…`);

  const quoteRes = await fetch(`${APP}/api/broker/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, requester_wallet: process.env.DEMAND_ADDRESS }),
  });
  const quote = await quoteRes.json();
  if (quote.declined) {
    console.log(`broker declined: ${quote.reason}`);
    return;
  }

  // the agentic part: judge whether this quote is worth it
  const { data: ledger } = await supabase
    .from("budget_ledger")
    .select("budget_usdc,spent_usdc")
    .eq("id", ledgerId())
    .maybeSingle();
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
    return;
  }

  // atomic budget check-and-decrement — delayed/overlapping runs can never overspend
  const { data: ok, error } = await supabase.rpc("spend_budget", {
    p_id: ledgerId(),
    p_amount: quote.total_price_usdc,
    p_daily: DAILY_BUDGET,
  });
  if (error) throw new Error(`budget rpc: ${error.message}`);
  if (!ok) {
    console.log("daily budget exhausted — skipping");
    return;
  }

  await ensureGatewayFloat(process.env.DEMAND_PRIVATE_KEY!, 0.05, 0.5);
  const { result } = await payEndpoint(
    `${APP}/api/broker/execute/${quote.quote_id}?source=demand_agent`,
    quote.total_price_usdc,
    process.env.DEMAND_PRIVATE_KEY!,
    { method: "POST", body: "{}" },
  );
  const d = result.data as any;
  console.log(`outcome: ${d.status} (score ${d.validation?.score}) — paid $${quote.total_price_usdc}`);
}

const ledgerId = () => `demand:${new Date().toISOString().slice(0, 10)}`;

const loop = process.argv.includes("--loop");
const cyclesArg = process.argv.indexOf("--cycles");
const cycles = cyclesArg > -1 ? Number(process.argv[cyclesArg + 1]) : 1;

if (loop) {
  for (;;) {
    await cycle().catch((e) => console.error("cycle error:", e instanceof Error ? e.message : e));
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
} else {
  for (let i = 0; i < cycles; i++) {
    await cycle().catch((e) => {
      console.error("cycle error:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
  }
}
