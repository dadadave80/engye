-- Async verdict split (spec 2026-07-04): delivery returns immediately; validation+settlement
-- run after VERDICT_WINDOW_SECONDS. New match statuses: awaiting_verdict | validating | settle_retry
-- (all swept by /api/settle together with 'error'). validating_at is the settle lease timestamp.
alter table matches add column if not exists verdict_due_at timestamptz;
alter table matches add column if not exists validating_at timestamptz;
-- settlement needs the payer without re-deriving it (Phase B runs detached from the request)
alter table matches add column if not exists requester_wallet text;
comment on column matches.status is 'pending|bonded|paid|awaiting_verdict|validating|settle_retry|delivered|failed_compensated|error';

-- Passkey direct-transfer payment proofs: tx bound to its quote at relay time; never deleted.
alter table payments add column if not exists quote_id uuid references quotes(id);
create unique index if not exists payments_inbound_tx_key
  on payments (gateway_tx) where direction = 'inbound' and gateway_tx is not null;
