-- 084_accounting_check_shipments.sql
-- Check Shipment Amazon tracking table for Inventory module

CREATE TABLE IF NOT EXISTS accounting_amazon_check_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  ngay_update TEXT,
  brand TEXT,
  shipment_name TEXT,
  shipment_id TEXT NOT NULL,
  created_date TEXT,
  last_updated_date TEXT,
  ship_to TEXT,
  skus_count INTEGER DEFAULT 1,
  units_expected INTEGER DEFAULT 0,
  units_located INTEGER DEFAULT 0,
  discrepancy INTEGER DEFAULT 0,
  status TEXT,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  last_changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_check_shipments_store
  ON accounting_amazon_check_shipments (store_id);

CREATE INDEX IF NOT EXISTS idx_accounting_check_shipments_shipment_id
  ON accounting_amazon_check_shipments (shipment_id);

CREATE INDEX IF NOT EXISTS idx_accounting_check_shipments_status
  ON accounting_amazon_check_shipments (store_id, status);

CREATE INDEX IF NOT EXISTS idx_accounting_check_shipments_active
  ON accounting_amazon_check_shipments (store_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Update history check constraint to allow 'check_shipment'
ALTER TABLE inventory_change_history DROP CONSTRAINT IF EXISTS inventory_change_history_entity_type_check;
ALTER TABLE inventory_change_history ADD CONSTRAINT inventory_change_history_entity_type_check
  CHECK (entity_type IN ('sku', 'inbound', 'check_shipment'));

-- Trigger for auto change tracking
DROP TRIGGER IF EXISTS trg_accounting_check_shipments_history ON accounting_amazon_check_shipments;
CREATE TRIGGER trg_accounting_check_shipments_history
AFTER INSERT OR UPDATE ON accounting_amazon_check_shipments
FOR EACH ROW EXECUTE FUNCTION record_inventory_change('check_shipment');
