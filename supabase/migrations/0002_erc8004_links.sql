-- ERC-8004 linkage: provider agent ids + per-step Arcscan tx links on matches
alter table providers add column if not exists agent_id bigint;
alter table matches add column if not exists validation_request_tx text;
alter table matches add column if not exists validation_response_tx text;
alter table matches add column if not exists feedback_tx text;
alter table matches add column if not exists stake_slash_tx text;
