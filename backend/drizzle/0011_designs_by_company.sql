-- Designs belong to the company (Fase 05, etapa 2). From here on a design is seen, changed and deleted by every user of
-- the company that owns it, and its name is unique inside the company (it was unique per user). `designs.user_id`
-- stays as "who created it".
--
-- This file: (1) fills what migration 0010 left empty, as a safety net; (2) renames the newer one of two designs that
-- would end up with the same name in the same company ("Name (id)"; nothing is deleted, and if there is no such pair
-- nothing is renamed) so that the next steps cannot fail and keep the server from starting; (3) swaps the unique
-- constraint; (4) makes the company of users and designs mandatory.
--
-- Rollback (the data keeps working; only the sharing and the rules go back):
--   ALTER TABLE "designs" ALTER COLUMN "company_id" DROP NOT NULL;
--   ALTER TABLE "users" ALTER COLUMN "company_id" DROP NOT NULL;
--   DROP INDEX IF EXISTS "uq_designs_company_name";
--   ALTER TABLE "designs" ADD CONSTRAINT "designs_user_id_name_unique" UNIQUE ("user_id", "name");
--   (the last line fails if two users of one company now share a name: rename one first)

-- (1) Users and designs without a company (none are expected: 0010 filled them and new users get one)
DO $$
DECLARE
  sinosbyte_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "company_id" IS NULL AND ("is_admin" OR "username" = 'sinosbyte')) THEN
    SELECT "id" INTO sinosbyte_id FROM "companies" WHERE "name" = 'Sinosbyte' ORDER BY "id" LIMIT 1;
    IF sinosbyte_id IS NULL THEN
      INSERT INTO "companies" ("name") VALUES ('Sinosbyte') RETURNING "id" INTO sinosbyte_id;
    END IF;
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

UPDATE "designs" d
   SET "company_id" = u."company_id"
  FROM "users" u
 WHERE d."user_id" = u."id" AND d."company_id" IS NULL;

-- (2) Two designs with the same name in one company: the oldest keeps its name, the others get "(id)" added
UPDATE "designs" d
   SET "name" = d."name" || ' (' || d."id" || ')'
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "company_id", "name" ORDER BY "created_at", "id") AS "n"
      FROM "designs"
  ) x
 WHERE d."id" = x."id" AND x."n" > 1;

-- (3) Unique per company instead of per user (same rule as before otherwise: case-sensitive)
ALTER TABLE "designs" DROP CONSTRAINT IF EXISTS "designs_user_id_name_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_designs_company_name" ON "designs" ("company_id", "name");

-- (4) Every user and every design has a company
ALTER TABLE "users" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "designs" ALTER COLUMN "company_id" SET NOT NULL;
