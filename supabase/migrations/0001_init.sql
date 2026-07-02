-- ENGYE schema v1 (plan §6). Service role writes; public reads (dashboard is public).

create table providers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  endpoint_url text not null unique,
  price_usdc numeric not null,
  capabilities text[] not null default '{}',
  description text,
  wallet_address text not null,
  agent_card_url text,
  in_house boolean not null default false,
  active boolean not null default true,
  -- reputation aggregates (feed calibrated confidence ĉ)
  trials int not null default 0,
  passes int not null default 0,
  avg_score numeric,
  avg_latency_ms numeric,
  total_earned_usdc numeric not null default 0,
  slashes_caused int not null default 0,
  reputation_prior numeric
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task jsonb not null,
  requester_wallet text,
  provider_id uuid references providers(id),
  action text not null, -- accept | decline | best_effort_offer
  confidence numeric,
  calibrated_confidence numeric,
  bond_usdc numeric,
  fee_usdc numeric,
  total_price_usdc numeric,
  reasoning text,
  decline_reason text,
  expires_at timestamptz,
  status text not null default 'open' -- open | executed | expired
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  quote_id uuid references quotes(id),
  provider_id uuid references providers(id),
  match_key text not null unique, -- bytes32 hex used on-chain
  status text not null default 'pending', -- pending|bonded|paid|delivered|failed_compensated|error
  decision_json jsonb, -- broker's full reasoning, first-class data
  bond_usdc numeric,
  price_usdc numeric,
  bond_tx text,
  settle_tx text,
  pay_tx text,
  refund_tx text,
  deliverable jsonb,
  source text not null default 'organic', -- organic | demand_agent
  latency_ms int,
  settled_at timestamptz
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null, -- broker_quote | validator | demand_buy
  quote_id uuid references quotes(id),
  match_id uuid references matches(id),
  llm_provider text, -- groq | anthropic
  model text,
  prompt_hash text,
  raw_json jsonb,
  derived jsonb,
  latency_ms int
);

create table validations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  match_id uuid references matches(id),
  pass boolean not null,
  score int,
  reasons jsonb,
  model text
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  match_id uuid references matches(id),
  direction text not null, -- inbound (requester->engye) | outbound (engye->provider)
  endpoint text,
  payer text,
  amount_usdc numeric,
  network text,
  gateway_tx text,
  raw jsonb
);

create table reputation_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider_id uuid references providers(id),
  match_id uuid references matches(id),
  passed boolean not null,
  score int,
  onchain_tx text
);

create table budget_ledger (
  id text primary key, -- e.g. 'demand:2026-07-04'
  budget_usdc numeric not null,
  spent_usdc numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- atomic check-and-decrement: overlapping demand-agent runs can never overspend
create or replace function spend_budget(p_id text, p_amount numeric, p_daily numeric)
returns boolean language plpgsql as $$
begin
  insert into budget_ledger (id, budget_usdc, spent_usdc) values (p_id, p_daily, 0)
  on conflict (id) do nothing;
  update budget_ledger
     set spent_usdc = spent_usdc + p_amount, updated_at = now()
   where id = p_id and spent_usdc + p_amount <= budget_usdc;
  return found;
end $$;

-- realtime for the live dashboard
alter publication supabase_realtime add table providers;
alter publication supabase_realtime add table quotes;
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table validations;

-- RLS: public read everywhere; writes only via service role (bypasses RLS)
alter table providers enable row level security;
alter table quotes enable row level security;
alter table matches enable row level security;
alter table decisions enable row level security;
alter table validations enable row level security;
alter table payments enable row level security;
alter table reputation_events enable row level security;
alter table budget_ledger enable row level security;

create policy "public read" on providers for select using (true);
create policy "public read" on quotes for select using (true);
create policy "public read" on matches for select using (true);
create policy "public read" on decisions for select using (true);
create policy "public read" on validations for select using (true);
create policy "public read" on payments for select using (true);
create policy "public read" on reputation_events for select using (true);
