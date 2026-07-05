-- one inbound payment per quote — the atomic claim that prevents a concurrent double-charge on the
-- passkey pay path (mirrors the execute route's open->executing atomic claim). A pending claim row is
-- inserted (gateway_tx NULL) BEFORE relay; the second concurrent request hits this and 409s pre-relay.
create unique index if not exists payments_inbound_quote_key on payments (quote_id) where direction = 'inbound';
