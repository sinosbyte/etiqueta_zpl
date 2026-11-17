-- How the pages of a design version are printed (the first once, the second repeated for the records left
-- over) and the test records its tables show. NULL = a design of one page, which is every version saved
-- before this column. Nothing existing is changed: the column is added empty.
ALTER TABLE "design_versions" ADD COLUMN IF NOT EXISTS "pages_config" jsonb;
