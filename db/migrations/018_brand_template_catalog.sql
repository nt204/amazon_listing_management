ALTER TABLE listing_templates
  ADD COLUMN IF NOT EXISTS brand_profile_id UUID,
  ADD COLUMN IF NOT EXISTS brand_name TEXT NOT NULL DEFAULT 'Limima',
  ADD COLUMN IF NOT EXISTS phoi_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phoi_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_template_id UUID,
  ADD COLUMN IF NOT EXISTS is_auto_mapped BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE listing_templates
SET phoi_name = name
WHERE phoi_name = '';

UPDATE listing_templates
SET phoi_key = COALESCE(
  NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(phoi_name), '[^a-z0-9]+', '-', 'g')), ''),
  MD5(phoi_name)
)
WHERE phoi_key = '';

ALTER TABLE listing_templates
  DROP CONSTRAINT IF EXISTS listing_templates_brand_profile_fk;

ALTER TABLE listing_templates
  ADD CONSTRAINT listing_templates_brand_profile_fk
  FOREIGN KEY (brand_profile_id) REFERENCES brand_profiles(id) ON DELETE SET NULL;

ALTER TABLE listing_templates
  DROP CONSTRAINT IF EXISTS listing_templates_source_template_fk;

ALTER TABLE listing_templates
  ADD CONSTRAINT listing_templates_source_template_fk
  FOREIGN KEY (source_template_id) REFERENCES listing_templates(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS listing_templates_team_shop_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS listing_templates_team_shop_brand_phoi_unique
  ON listing_templates(team_id, shop_id, LOWER(brand_name), LOWER(phoi_key));

CREATE INDEX IF NOT EXISTS listing_templates_team_phoi_idx
  ON listing_templates(team_id, phoi_key, updated_at DESC);
