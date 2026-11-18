-- Named sets of test data of a design (the values of its variables and the records of its tables).
-- A new table: nothing that exists is changed. They go away with their design (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS "design_test_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "design_id" integer NOT NULL REFERENCES "designs"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sample_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "records" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_design_test_variants_name" ON "design_test_variants" ("design_id", lower("name"));
CREATE INDEX IF NOT EXISTS "idx_design_test_variants_design" ON "design_test_variants" ("design_id");
