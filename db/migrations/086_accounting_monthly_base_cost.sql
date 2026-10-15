-- 086_accounting_monthly_base_cost.sql
-- Monthly Base Cost calculation per SKU per Month for Inventory module

CREATE TABLE IF NOT EXISTS accounting_monthly_base_cost (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- Format: YYYY-MM (e.g. 2026-04)
  sku TEXT NOT NULL,
  sku_id UUID REFERENCES accounting_sku_master(id) ON DELETE SET NULL,
  brand TEXT,
  product_type TEXT,
  sl_ton_dau_ky NUMERIC(12, 2) NOT NULL DEFAULT 0,
  basecost_dau_ky NUMERIC(10, 4) NOT NULL DEFAULT 0,
  gtri_ton_dau_ky NUMERIC(14, 4) NOT NULL DEFAULT 0,
  sl_nhap NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gtri_nhap NUMERIC(14, 4) NOT NULL DEFAULT 0,
  don_gia_nhap_tb NUMERIC(10, 4) NOT NULL DEFAULT 0,
  tong_sl_kha_dung NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tong_gtri_kha_dung NUMERIC(14, 4) NOT NULL DEFAULT 0,
  basecost_thang NUMERIC(10, 4) NOT NULL DEFAULT 0,
  calculation_rule TEXT NOT NULL DEFAULT 'carry_over', -- 'weighted_average' | 'new_inbound_only' | 'carry_over' | 'existing_inventory'
  is_overridden BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  row_order INTEGER DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  last_changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_monthly_base_cost_store_period_sku UNIQUE (store_id, period, sku)
);

CREATE INDEX IF NOT EXISTS idx_monthly_base_cost_store_period
  ON accounting_monthly_base_cost (store_id, period);

CREATE INDEX IF NOT EXISTS idx_monthly_base_cost_sku
  ON accounting_monthly_base_cost (store_id, sku);

CREATE INDEX IF NOT EXISTS idx_monthly_base_cost_active
  ON accounting_monthly_base_cost (store_id, period, created_at DESC)
  WHERE deleted_at IS NULL;

-- Allow 'monthly_base_cost' in inventory_change_history
ALTER TABLE inventory_change_history DROP CONSTRAINT IF EXISTS inventory_change_history_entity_type_check;
ALTER TABLE inventory_change_history ADD CONSTRAINT inventory_change_history_entity_type_check
  CHECK (entity_type IN ('sku', 'inbound', 'check_shipment', 'monthly_base_cost'));

-- Trigger for auto change tracking
DROP TRIGGER IF EXISTS trg_accounting_monthly_base_cost_history ON accounting_monthly_base_cost;
CREATE TRIGGER trg_accounting_monthly_base_cost_history
AFTER INSERT OR UPDATE ON accounting_monthly_base_cost
FOR EACH ROW EXECUTE FUNCTION record_inventory_change('monthly_base_cost');
