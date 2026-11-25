-- Integration tokens belong to the company (Fase 06, etapa 1). A token used to belong to a person: deactivating or
-- deleting that person stopped the SAP capture of the whole company. From here on:
--  (1) every token has the company it reads (`company_id`), filled with the company of its current owner, so every
--      existing token keeps reading exactly the same designs;
--  (2) `user_id` only says who generated the token: it is optional and becomes NULL if that user is deleted (the token
--      stays); the token works while its company is active, whoever generated it.
--
-- Rollback (tokens without a user would have to be deleted first, since user_id becomes required again):
--   DELETE FROM "api_tokens" WHERE "user_id" IS NULL;
--   ALTER TABLE "api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_user_id_users_id_fk";
--   ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--   ALTER TABLE "api_tokens" ALTER COLUMN "user_id" SET NOT NULL;
--   DROP INDEX IF EXISTS "idx_api_tokens_company_id";
--   ALTER TABLE "api_tokens" DROP COLUMN IF EXISTS "company_id";

-- (1)
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "company_id" integer REFERENCES "companies"("id");
UPDATE "api_tokens" t SET "company_id" = u."company_id"
  FROM "users" u
 WHERE u."id" = t."user_id" AND t."company_id" IS NULL;
ALTER TABLE "api_tokens" ALTER COLUMN "company_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_api_tokens_company_id" ON "api_tokens" ("company_id");

-- (2) Whatever the name of the old constraint on user_id (it was declared inline in 0004), replace it
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = '"api_tokens"'::regclass AND con.contype = 'f' AND a.attname = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE "api_tokens" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE "api_tokens" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
