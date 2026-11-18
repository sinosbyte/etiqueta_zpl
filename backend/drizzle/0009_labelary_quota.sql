-- Control of the use of the Labelary service (see src/labelary/quota.ts). Three new tables: nothing that exists is
-- changed, and no data of designs or users is touched. The code that came before ignores them, so going back is
-- dropping them (rollback, in this order; the data is only counters):
--   DROP TABLE IF EXISTS "labelary_holds"; DROP TABLE IF EXISTS "labelary_block"; DROP TABLE IF EXISTS "labelary_requests";

-- One row for every request actually sent to the service, with the exact time it was sent. The limit is a count of
-- these rows in the last 24 hours. `user_id` has no foreign key on purpose: the count must not shrink when a user is
-- deleted. Rows older than 25 hours are of no use and are deleted (the window is 24 h; the hour is slack).
CREATE TABLE IF NOT EXISTS "labelary_requests" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "sent_at" timestamptz NOT NULL,
  "user_id" integer
);
-- The count and the cleaning are both ranges of sent_at
CREATE INDEX IF NOT EXISTS "idx_labelary_requests_sent_at" ON "labelary_requests" ("sent_at");

-- At most one row (id = 1): the service said its own quota is used up, until when. Kept so that every instance and
-- every restart honours it.
CREATE TABLE IF NOT EXISTS "labelary_block" (
  "id" smallint PRIMARY KEY NOT NULL CHECK ("id" = 1),
  "until" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "set_at" timestamptz NOT NULL
);

-- Room kept for a mass export (a PDF) before it starts, so that it does not start and then be stopped by the limit:
-- `slots` are the requests still kept for it. They count against the limit while the hold lasts and are released when
-- the export ends, is cancelled or the hold expires. A user has at most one.
CREATE TABLE IF NOT EXISTS "labelary_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL,
  "slots" integer NOT NULL CHECK ("slots" >= 0),
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_labelary_holds_user" ON "labelary_holds" ("user_id");
