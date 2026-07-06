// Bond-aware worker experiment readout: pass rate + avg validator score, "aware" arm vs baseline.
// The execute route (BOND_AWARE_WORKER=1) randomizes each bonded in-house match into an arm and tags
// it in matches.decision_json.experiment.bond_aware; this joins that tag with the validator verdict.
//   Run: bun scripts/bond-experiment.ts
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data, error } = await sb.from("matches").select("decision_json, validations(pass, score)");
if (error) throw new Error(error.message);

const arms = { aware: { n: 0, pass: 0, score: 0 }, baseline: { n: 0, pass: 0, score: 0 } };
for (const m of data ?? []) {
  const flag = (m.decision_json as { experiment?: { bond_aware?: boolean } } | null)?.experiment?.bond_aware;
  if (flag === undefined || flag === null) continue; // not in the experiment
  const v = Array.isArray(m.validations) ? m.validations[0] : m.validations;
  if (!v) continue; // no verdict yet
  const a = arms[flag ? "aware" : "baseline"];
  a.n++; a.pass += v.pass ? 1 : 0; a.score += Number(v.score ?? 0);
}

const passPct = (a: { n: number; pass: number }) => (a.n ? (100 * a.pass) / a.n : NaN);
const row = (label: string, a: { n: number; pass: number; score: number }) =>
  `${label.padEnd(9)} n=${String(a.n).padStart(4)}  pass=${a.n ? passPct(a).toFixed(1).padStart(5) : "    -"}%  avg_score=${a.n ? (a.score / a.n).toFixed(1) : "-"}`;

console.log("BOND-AWARE WORKER EXPERIMENT — bonded in-house matches with a verdict\n");
console.log(row("aware", arms.aware));
console.log(row("baseline", arms.baseline));
console.log(
  arms.aware.n && arms.baseline.n
    ? `\nlift (aware − baseline): ${passPct(arms.aware) - passPct(arms.baseline) >= 0 ? "+" : ""}${(passPct(arms.aware) - passPct(arms.baseline)).toFixed(1)} pp`
    : "\n(need verdicts in BOTH arms to compute lift — let more bonded matches settle with BOND_AWARE_WORKER=1)",
);
