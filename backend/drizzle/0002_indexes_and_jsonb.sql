-- Index on designs.user_id for faster per-user queries (listDesigns, ownershipCheck)
CREATE INDEX IF NOT EXISTS idx_designs_user_id ON designs (user_id);

-- Convert elements_json from text to jsonb for server-side validation and future querying
ALTER TABLE design_versions
  ALTER COLUMN elements_json TYPE jsonb USING elements_json::jsonb;
