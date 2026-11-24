-- Companies (Fase 05, etapa 1: the foundation). A company owns users and designs. Nothing that exists changes its
-- behaviour: the columns below are added and filled, and the code of this stage only fills them for new users and new
-- designs. Who sees which design, how users log in and what an administrator can do are the same as before.
--
-- The new columns are nullable on purpose in this stage (designs.company_id, users.company_id): the next stage makes
-- them NOT NULL once everything that inserts a row sets them.
--
-- Rollback (nothing else reads these columns in this stage; the data is only the company of each row):
--   ALTER TABLE "designs" DROP COLUMN IF EXISTS "company_id";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "active", DROP COLUMN IF EXISTS "role",
--                       DROP COLUMN IF EXISTS "email", DROP COLUMN IF EXISTS "company_id";
--   DROP TABLE IF EXISTS "companies";

CREATE TABLE IF NOT EXISTS "companies" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- role: 'platform_admin' (Sinosbyte: templates and companies), 'company_admin' (the users of its company) or 'member'.
-- Stage 1 only stores it; users.is_admin is still what decides who publishes templates.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "designs" ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");

CREATE INDEX IF NOT EXISTS "idx_users_company_id" ON "users" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_designs_company_id" ON "designs" ("company_id");

-- Existing users, so that nobody starts seeing another person's designs:
--  * the administrators and the `sinosbyte` account (the one the SAP capture uses) go to the company "Sinosbyte";
--  * every other user gets a company of their own, named after the username, and is its administrator.
-- Only rows without a company are touched, so running this again changes nothing.
DO $$
DECLARE
  sinosbyte_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "company_id" IS NULL AND ("is_admin" OR "username" = 'sinosbyte')) THEN
    INSERT INTO "companies" ("name") VALUES ('Sinosbyte') RETURNING "id" INTO sinosbyte_id;
    UPDATE "users"
       SET "company_id" = sinosbyte_id,
           "role" = CASE WHEN "is_admin" THEN 'platform_admin' ELSE 'company_admin' END
     WHERE "company_id" IS NULL AND ("is_admin" OR "username" = 'sinosbyte');
  END IF;
END $$;

WITH created AS (
  INSERT INTO "companies" ("name")
  SELECT "username" FROM "users" WHERE "company_id" IS NULL ORDER BY "id"
  RETURNING "id", "name"
)
UPDATE "users" u
   SET "company_id" = created."id", "role" = 'company_admin'
  FROM created
 WHERE u."company_id" IS NULL AND u."username" = created."name";

-- A design belongs to the company of the user who created it
UPDATE "designs" d
   SET "company_id" = u."company_id"
  FROM "users" u
 WHERE d."user_id" = u."id" AND d."company_id" IS NULL;
