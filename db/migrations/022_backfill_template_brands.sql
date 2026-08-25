INSERT INTO brand_profiles (id, team_id, name, guidelines)
SELECT
  (
    SUBSTR(MD5(shop.team_id || ':brand:' || LOWER(shop.name)), 1, 8) || '-' ||
    SUBSTR(MD5(shop.team_id || ':brand:' || LOWER(shop.name)), 9, 4) || '-' ||
    SUBSTR(MD5(shop.team_id || ':brand:' || LOWER(shop.name)), 13, 4) || '-' ||
    SUBSTR(MD5(shop.team_id || ':brand:' || LOWER(shop.name)), 17, 4) || '-' ||
    SUBSTR(MD5(shop.team_id || ':brand:' || LOWER(shop.name)), 21, 12)
  )::UUID,
  shop.team_id,
  shop.name,
  ''
FROM amazon_shops AS shop
WHERE shop.is_unassigned = FALSE
  AND EXISTS (
    SELECT 1 FROM listing_templates AS template
    WHERE template.team_id = shop.team_id AND template.shop_id = shop.id
  )
ON CONFLICT (team_id, name) DO NOTHING;

UPDATE listing_templates AS template
SET brand_profile_id = brand.id,
    updated_at = NOW()
FROM brand_profiles AS brand
WHERE template.team_id = brand.team_id
  AND LOWER(template.brand_name) = LOWER(brand.name)
  AND template.brand_profile_id IS NULL;
