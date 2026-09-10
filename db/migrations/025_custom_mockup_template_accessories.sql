ALTER TABLE custom_mockup_templates
ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
