-- Petals balances. Applied by server/petals/store.pg.js on boot; safe to re-run.
--
-- The ledger is the balance. There is no mutable petals column, deliberately:
-- every question anyone asks about a loyalty balance is historical, and a
-- single integer answers none of them.

CREATE TABLE IF NOT EXISTS petals_customer (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL UNIQUE,          -- E.164, +1XXXXXXXXXX
  name        text NOT NULL,
  clover_id   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS petals_ledger (
  id           bigserial PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES petals_customer(id),
  delta        integer NOT NULL,             -- + earned, - reserved
  reason       text NOT NULL,                -- earned | reserved | released | adjusted
  order_id     text,
  reward_id    text,
  -- The whole guard against double-crediting. Keys are deterministic:
  -- earn:<orderId>, reserve:<orderId>, release:<orderId>, migrate:<phone>.
  -- A second attempt violates this and is swallowed by the store.
  idem_key     text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS petals_ledger_customer ON petals_ledger (customer_id);

CREATE TABLE IF NOT EXISTS petals_order (
  id            bigserial PRIMARY KEY,
  customer_id   bigint NOT NULL REFERENCES petals_customer(id),
  order_id      text NOT NULL UNIQUE,        -- one row per Clover order
  -- A reward is optional. An order with no reward still needs a row, because
  -- the earnable has to survive until Clover confirms the payment — the cart it
  -- was computed from is long gone by then.
  reward_id     text,
  hold          integer NOT NULL DEFAULT 0,  -- Petals held for the reward
  amount_cents  integer NOT NULL DEFAULT 0,  -- the discount actually applied
  earnable      integer NOT NULL DEFAULT 0,  -- credited when the order is paid
  state         text NOT NULL DEFAULT 'open',  -- open | settled | released | expired
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz
);

-- The expiry sweep's access pattern: open rows with a hold, older than a cutoff.
CREATE INDEX IF NOT EXISTS petals_order_open
  ON petals_order (state, created_at);
