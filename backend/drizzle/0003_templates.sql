-- Sinosbyte administrators (set by hand: UPDATE users SET is_admin = true WHERE username = '...')
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Ready-made label templates, the same for every user
CREATE TABLE IF NOT EXISTS "templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "zpl" text NOT NULL,
  "elements_json" jsonb NOT NULL,
  "label_width" integer NOT NULL,
  "label_height" integer NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "templates_name_unique" UNIQUE("name")
);
