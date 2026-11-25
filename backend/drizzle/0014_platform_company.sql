-- The platform company (Fase 06, etapa 2). The Sinosbyte administrators stop belonging to a client company: they get a
-- company of their own, marked `is_platform`, that has no designs and no integration tokens and is not listed among the
-- clients. This file:
--  (1) adds `companies.is_platform` (false for every existing company) and allows a single platform company;
--  (2) creates "Plataforma Sinosbyte" (if there is none yet);
--  (3) moves every platform_admin into it. Their designs stay in the company they were in (a design belongs to the
--      company; `designs.user_id` only says who created it), and so do the tokens they generated (Fase 06, etapa 1).
--
-- Rollback (moves the platform administrators back to a company of choice, then removes the platform company):
--   UPDATE "users" SET "company_id" = <id of the company to go back to> WHERE "company_id" = (SELECT "id" FROM "companies" WHERE "is_platform");
--   DELETE FROM "companies" WHERE "is_platform";
--   DROP INDEX IF EXISTS "uq_companies_platform";
--   ALTER TABLE "companies" DROP COLUMN IF EXISTS "is_platform";

-- (1)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "is_platform" boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_companies_platform" ON "companies" ("is_platform") WHERE "is_platform";

-- (2)
INSERT INTO "companies" ("name", "is_platform")
SELECT 'Plataforma Sinosbyte', true
 WHERE NOT EXISTS (SELECT 1 FROM "companies" WHERE "is_platform");

-- (3)
UPDATE "users" SET "company_id" = (SELECT "id" FROM "companies" WHERE "is_platform")
 WHERE "role" = 'platform_admin'
   AND "company_id" <> (SELECT "id" FROM "companies" WHERE "is_platform");
