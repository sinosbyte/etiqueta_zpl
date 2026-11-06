-- Example value of each {{variable}} of a design version, so the preview opens already filled in.
-- NULL = none saved (every version saved before this column).
ALTER TABLE "design_versions" ADD COLUMN IF NOT EXISTS "sample_values" jsonb;
