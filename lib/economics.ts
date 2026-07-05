// Plan §4 — implement exactly; the broker LLM never does arithmetic, these do.

export const FEE_BPS = Number(process.env.FEE_BPS ?? 200);
export const MIN_BOND = Number(process.env.MIN_BOND ?? 0.001);
export const MAX_BOND = Number(process.env.MAX_BOND ?? 0.25);
export const RISK_MARGIN = Number(process.env.RISK_MARGIN ?? 1.0);
export const MIN_FEE = 0.0005;
export const MATCH_TTL_SECONDS = 600; // bond deadline; > full lifecycle, < stake cooldown (1h)
export const VERDICT_WINDOW_SECONDS = Number(process.env.VERDICT_WINDOW_SECONDS ?? 120); // odds/verdict window (spec 2026-07-04)
export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const BEST_EFFORT_FEE_DISCOUNT = 0.5;

export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export const feeFor = (priceUsdc: number) =>
  round6(Math.max(MIN_FEE, (priceUsdc * FEE_BPS) / 10_000));

/** Confidence → bond: m = clamp(1 + round((c − 0.5) × 8), 1, 5); bond = price × m, floored/capped. */
export const bondFor = (priceUsdc: number, confidence: number) => {
  const m = Math.min(5, Math.max(1, 1 + Math.round((confidence - 0.5) * 8)));
  return round6(Math.min(MAX_BOND, Math.max(MIN_BOND, priceUsdc * m)));
};

/** Beta-smoothed pass rate. */
export const betaConfidence = (passes: number, trials: number) => (passes + 2) / (trials + 4);

/** ĉ: blend 50/50 with the broker's stated c until the provider has ≥10 trials. */
export const calibratedConfidence = (stated: number, passes: number, trials: number) => {
  const beta = betaConfidence(passes, trials);
  return trials >= 10 ? beta : 0.5 * beta + 0.5 * stated;
};

/** EV gate: accept only if fee covers expected slash loss. */
export const evGateAccepts = (feeUsdc: number, bondUsdc: number, cHat: number) =>
  feeUsdc >= (1 - cHat) * bondUsdc * RISK_MARGIN;
