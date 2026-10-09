-- 073_accounting_stores_and_legal_entities.sql
-- Accounting module: Store Master and Legal Entities tables

CREATE TABLE IF NOT EXISTS legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'United States',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'Amazon US',
  legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE SET NULL,
  seller_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stores_name_marketplace_unique UNIQUE(name, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
CREATE INDEX IF NOT EXISTS idx_stores_legal_entity ON stores(legal_entity_id);

-- Update existing app users to have 'accounting' feature
UPDATE app_users
SET allowed_features = array_append(allowed_features, 'accounting')
WHERE NOT ('accounting' = ANY(allowed_features));

-- Seed initial Legal Entity
INSERT INTO legal_entities (name, country, status)
VALUES ('NCE US LLC', 'United States', 'active')
ON CONFLICT (name) DO NOTHING;

-- Seed initial Stores
INSERT INTO stores (name, marketplace, legal_entity_id, status)
SELECT s.name, 'Amazon US', le.id, 'active'
FROM (VALUES
  ('fastpeace'),
  ('limima'),
  ('warmstorey'),
  ('bozspacer'),
  ('malfirst')
) AS s(name)
CROSS JOIN (SELECT id FROM legal_entities WHERE name = 'NCE US LLC' LIMIT 1) le
ON CONFLICT (name, marketplace) DO NOTHING;
