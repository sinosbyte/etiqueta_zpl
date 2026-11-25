-- Users and their administration (Fase 05, etapa 3). From here on the role decides who manages templates, companies
-- and users, and an inactive user or company is refused on every request. This file:
--  (1) adds `must_change_password` (a user created or reset by an administrator gets a temporary password);
--  (2) makes the e-mail unique (whatever the case; users without e-mail are fine);
--  (3) allows only the three known roles;
--  (4) lines up `is_admin` and the role: whoever was an administrator is `platform_admin`, and `is_admin` mirrors the
--      role from now on (it is kept for whatever still reads it and for going back);
--  (5) a user who created designs can no longer be deleted by accident: deleting a user used to delete their designs,
--      and since stage 2 those belong to the company. Users are deactivated, not deleted.
--
-- Rollback:
--   ALTER TABLE "designs" DROP CONSTRAINT IF EXISTS "designs_user_id_users_id_fk";
--   ALTER TABLE "designs" ADD CONSTRAINT "designs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--   ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
--   DROP INDEX IF EXISTS "uq_users_email";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password";

-- (1)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;

-- (2) Nobody has an e-mail yet; if two had the same one, the newer would lose it instead of the migration failing
UPDATE "users" u SET "email" = NULL
  FROM (SELECT "id", row_number() OVER (PARTITION BY lower("email") ORDER BY "id") AS "n" FROM "users" WHERE "email" IS NOT NULL) x
 WHERE u."id" = x."id" AND x."n" > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_email" ON "users" (lower("email")) WHERE "email" IS NOT NULL;

-- (3) Anything unknown becomes a member before the rule is set
UPDATE "users" SET "role" = 'member' WHERE "role" NOT IN ('platform_admin', 'company_admin', 'member');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('platform_admin', 'company_admin', 'member'));
  END IF;
END $$;

-- (4)
UPDATE "users" SET "role" = 'platform_admin' WHERE "is_admin" AND "role" <> 'platform_admin';
UPDATE "users" SET "is_admin" = ("role" = 'platform_admin') WHERE "is_admin" <> ("role" = 'platform_admin');

-- (5)
ALTER TABLE "designs" DROP CONSTRAINT IF EXISTS "designs_user_id_users_id_fk";
ALTER TABLE "designs" ADD CONSTRAINT "designs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
