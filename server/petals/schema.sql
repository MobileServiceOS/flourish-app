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

-- ---------------------------------------------------------------------------
-- EARNING WITHOUT AN APP ORDER
--
-- Five ways to earn that are not "you ordered in the app and paid": a counter
-- receipt, a signup bonus, a birthday, a referral, and a staff-granted Perks
-- match. All of them are ledger rows like everything else, because the question
-- "where did this balance come from" has to stay answerable.
--
-- Every one is made once-only by a UNIQUE idem_key, not by a check-then-write.
-- The namespaces are:
--
--   receipt:<cloverOrderId>        one claim per order, ever, by anyone
--   signup:<phone>                 one per phone, ever
--   birthday:<phone>:<year>        one per phone per calendar year
--   referral-referee:<phone>       one per referred customer, ever
--   referral-referrer:<phone>      keyed by the REFEREE's phone, so a referrer
--                                  earns once per person they bring, not once
--   perks:<phone>                  one Perks match per phone, ever
--
-- Keying the receipt claim on the ORDER and not on the customer is the whole
-- control: a second person claiming the same receipt collides with the first
-- person's row and is credited nothing.

ALTER TABLE petals_customer ADD COLUMN IF NOT EXISTS birth_month smallint;
ALTER TABLE petals_customer ADD COLUMN IF NOT EXISTS birth_day   smallint;

-- Month/day only. The YEAR is deliberately not stored: a birthday reward needs
-- to know when to fire, not how old anyone is, and a date of birth is the kind
-- of field that turns a loyalty database into an identity-theft target.
-- ADD CONSTRAINT has no IF NOT EXISTS, and this file is re-applied on every
-- boot, so a bare ALTER would crash the server on its second start.
DO $$ BEGIN
  ALTER TABLE petals_customer ADD CONSTRAINT petals_birth_month_range
    CHECK (birth_month IS NULL OR (birth_month BETWEEN 1 AND 12));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE petals_customer ADD CONSTRAINT petals_birth_day_range
    CHECK (birth_day IS NULL OR (birth_day BETWEEN 1 AND 31));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Who referred this customer. Set once, at creation, and never updated — see
-- the referral notes in ledger.js for why it cannot be changed afterwards.
ALTER TABLE petals_customer ADD COLUMN IF NOT EXISTS referred_by bigint
  REFERENCES petals_customer(id);

-- The code this customer hands out. Unique, and not derived from the phone
-- number: a code that decodes to a phone number is a phone number printed on
-- a flyer.
ALTER TABLE petals_customer ADD COLUMN IF NOT EXISTS referral_code text;
CREATE UNIQUE INDEX IF NOT EXISTS petals_customer_referral_code
  ON petals_customer (referral_code) WHERE referral_code IS NOT NULL;

-- The rate limiter for receipt claims reads "how many claims has this customer
-- made since <time>", which is otherwise a sequential scan of the ledger.
CREATE INDEX IF NOT EXISTS petals_ledger_reason_time
  ON petals_ledger (customer_id, reason, created_at);
