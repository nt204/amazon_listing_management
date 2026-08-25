UPDATE listing_templates AS template
SET brand_name = shop.name,
    updated_at = NOW()
FROM amazon_shops AS shop
WHERE template.team_id = shop.team_id
  AND template.shop_id = shop.id
  AND template.brand_name = '__TEMPLATE_LIBRARY__';
