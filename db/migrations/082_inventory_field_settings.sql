CREATE TABLE IF NOT EXISTS accounting_inventory_field_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('sku', 'inbound')),
  field_id TEXT NOT NULL,
  label TEXT NOT NULL,
  input_type TEXT NOT NULL DEFAULT 'text' CHECK (input_type IN ('text', 'select')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  allow_custom_value BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, entity_type, field_id)
);
