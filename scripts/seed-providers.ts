// Seed the three in-house providers (idempotent upsert by endpoint_url).
// Run: bun scripts/seed-providers.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const APP = process.env.APP_URL ?? "https://engye.vercel.app";

const PROVIDERS = [
  {
    name: "ENGYE In-House: Quick Answers",
    endpoint_url: `${APP}/api/inhouse/quote`,
    price_usdc: 0.001,
    capabilities: ["question-answering", "lookup", "structured-output"],
    description: "Fast, cheap structured answers to small research and lookup tasks.",
    wallet_address: process.env.PROVIDER1_ADDRESS!,
    agent_id: Number(process.env.AGENT_ID_PROVIDER1),
    reputation_prior: 0.85,
    // Bayesian prior as pseudo-counts (registry probe calibration) — labeled in JUDGES.md
    trials: 10,
    passes: 9,
    in_house: true,
  },
  {
    name: "ENGYE In-House: Summarizer",
    endpoint_url: `${APP}/api/inhouse/summarize`,
    price_usdc: 0.003,
    capabilities: ["summarization", "structured-output"],
    description: "Mid-tier summarization of provided text into structured briefs.",
    wallet_address: process.env.PROVIDER2_ADDRESS!,
    agent_id: Number(process.env.AGENT_ID_PROVIDER2),
    reputation_prior: 0.8,
    trials: 10,
    passes: 8,
    in_house: true,
  },
  {
    name: "ENGYE In-House: Budget Answers",
    endpoint_url: `${APP}/api/inhouse/flaky`,
    price_usdc: 0.0005,
    capabilities: ["question-answering", "lookup"],
    description: "Ultra-cheap task responses with variable quality.",
    wallet_address: process.env.PROVIDER3_ADDRESS!,
    agent_id: Number(process.env.AGENT_ID_PROVIDER3),
    reputation_prior: 0.6,
    trials: 6,
    passes: 3,
    in_house: true,
  },
];

for (const p of PROVIDERS) {
  const { data, error } = await supabase
    .from("providers")
    .upsert(p, { onConflict: "endpoint_url" })
    .select("id,name")
    .single();
  if (error) throw new Error(`${p.name}: ${error.message}`);
  console.log(`${data.name} → ${data.id}`);
}
console.log("providers seeded ✓");
