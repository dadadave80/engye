// Demand agent — headless CLI entry (the GitHub Actions cron runs this; it holds DEMAND_PRIVATE_KEY
// as a secret). The buy-cycle logic lives in lib/demand.ts and is shared with the eve demand
// subagent (agent/subagents/demand/). Behaviour is unchanged: one cycle by default, --cycles N, or
// --loop every 5 minutes.
import { runCycle } from "../lib/demand";

const loop = process.argv.includes("--loop");
const cyclesArg = process.argv.indexOf("--cycles");
const cycles = cyclesArg > -1 ? Number(process.argv[cyclesArg + 1]) : 1;

if (loop) {
  for (;;) {
    await runCycle().catch((e) => console.error("cycle error:", e instanceof Error ? e.message : e));
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
} else {
  for (let i = 0; i < cycles; i++) {
    await runCycle().catch((e) => {
      console.error("cycle error:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
  }
}
