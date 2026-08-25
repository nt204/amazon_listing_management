CREATE TABLE IF NOT EXISTS amazon_shops (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  seller_id TEXT NOT NULL DEFAULT '',
  is_unassigned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS amazon_shops_team_name_unique
  ON amazon_shops(team_id, LOWER(name));

CREATE INDEX IF NOT EXISTS amazon_shops_team_updated_idx
  ON amazon_shops(team_id, updated_at DESC);

ALTER TABLE listing_templates
  ADD COLUMN IF NOT EXISTS shop_id UUID;

INSERT INTO amazon_shops (id, team_id, name, is_unassigned)
SELECT
  (
    SUBSTR(MD5(team_id || ':amazon-shop-unassigned'), 1, 8) || '-' ||
    SUBSTR(MD5(team_id || ':amazon-shop-unassigned'), 9, 4) || '-' ||
    SUBSTR(MD5(team_id || ':amazon-shop-unassigned'), 13, 4) || '-' ||
    SUBSTR(MD5(team_id || ':amazon-shop-unassigned'), 17, 4) || '-' ||
    SUBSTR(MD5(team_id || ':amazon-shop-unassigned'), 21, 12)
  )::UUID,
  team_id,
  'Chưa gán shop',
  TRUE
FROM listing_templates
GROUP BY team_id
ON CONFLICT DO NOTHING;

UPDATE listing_templates AS template
SET shop_id = shop.id
FROM amazon_shops AS shop
WHERE template.shop_id IS NULL
  AND shop.team_id = template.team_id
  AND shop.is_unassigned = TRUE;

ALTER TABLE listing_templates
  ALTER COLUMN shop_id SET NOT NULL;

ALTER TABLE listing_templates
  ADD CONSTRAINT listing_templates_shop_fk
  FOREIGN KEY (shop_id) REFERENCES amazon_shops(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS listing_templates_team_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS listing_templates_team_shop_name_unique
  ON listing_templates(team_id, shop_id, LOWER(name));

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS source_trello_card_id TEXT;

CREATE INDEX IF NOT EXISTS listings_team_trello_card_idx
  ON listings(team_id, source_trello_card_id, created_at DESC)
  WHERE source_trello_card_id IS NOT NULL;
