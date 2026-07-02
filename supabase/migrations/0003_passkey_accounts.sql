-- Passkey → Ithaca account mapping. The throwaway bootstrap EOA key is DISCARDED after
-- provisioning (non-custodial: the passkey is the sole controller), so nothing sensitive is
-- stored — only the public mapping credential_id → account + P-256 pubkey.
create table if not exists passkey_accounts (
  credential_id text primary key,
  account text not null unique,
  pub_x text not null,
  pub_y text not null,
  created_at timestamptz not null default now()
);
alter table passkey_accounts enable row level security;
-- no public policy: writes/reads happen only via the service role in the API routes.
