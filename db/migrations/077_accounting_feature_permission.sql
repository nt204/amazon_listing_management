-- Keep the database default aligned with the complete feature-permission list.
ALTER TABLE app_users
  ALTER COLUMN allowed_features
  SET DEFAULT ARRAY['listing', 'mockups', 'sellersprite', 'ppc', 'accounting']::TEXT[];

-- Ensure all existing users receive the accounting feature
UPDATE app_users
SET allowed_features = array_append(allowed_features, 'accounting')
WHERE NOT ('accounting' = ANY(allowed_features));
