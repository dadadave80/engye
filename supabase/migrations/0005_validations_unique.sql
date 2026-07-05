-- One verdict per match, enforced in the DB (spec §3.2 verdict-once). Without this, two concurrent
-- settlers (a live after() racing the /api/settle sweep past the lease) can both insert a validation
-- row; a later maybeSingle() then returns null+error on 2 rows and re-derives the LLM verdict forever,
-- which could drive fail-path money off a divergent verdict after the bond already released.
-- settle.ts relies on this index: the losing concurrent INSERT hits the unique violation, is swallowed,
-- and both settlers re-read the single canonical row.

-- Defensive: collapse any pre-existing duplicates (keep the earliest row per match) before the index.
delete from validations a
using validations b
where a.match_id = b.match_id
  and a.match_id is not null
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists validations_match_id_key on validations (match_id);
