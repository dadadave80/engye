-- Atomic provider-aggregate update: concurrent settlements for the same provider compose instead of
-- clobbering (was a JS read-modify-write in lib/reputation.ts). Running averages use the pre-update
-- trials value — all SET right-hand sides see the OLD row in a single UPDATE.
create or replace function apply_outcome(
  p_provider_id uuid, p_pass boolean, p_score numeric, p_latency numeric, p_earned numeric
) returns void language sql as $$
  update providers set
    avg_score        = (coalesce(avg_score, 0) * trials + p_score)   / (trials + 1),
    avg_latency_ms   = (coalesce(avg_latency_ms, 0) * trials + p_latency) / (trials + 1),
    trials           = trials + 1,
    passes           = passes + (case when p_pass then 1 else 0 end),
    slashes_caused   = slashes_caused + (case when p_pass then 0 else 1 end),
    total_earned_usdc = total_earned_usdc + p_earned
  where id = p_provider_id;
$$;
