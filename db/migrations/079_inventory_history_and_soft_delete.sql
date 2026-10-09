-- Recoverable inventory changes: soft delete plus append-only row history.

ALTER TABLE accounting_sku_master
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_changed_by TEXT;

ALTER TABLE accounting_inbound_shipments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_changed_by TEXT;

CREATE TABLE IF NOT EXISTS inventory_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('sku', 'inbound')),
  entity_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  before_data JSONB,
  after_data JSONB,
  changed_by TEXT NOT NULL DEFAULT 'system',
  batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_history_entity
  ON inventory_change_history (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_history_store
  ON inventory_change_history (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_sku_master_active
  ON accounting_sku_master (store_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_inbound_active
  ON accounting_inbound_shipments (store_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION record_inventory_change()
RETURNS TRIGGER AS $$
DECLARE
  entity_kind TEXT := TG_ARGV[0];
  change_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    change_action := 'create';
    INSERT INTO inventory_change_history
      (entity_type, entity_id, store_id, action, before_data, after_data, changed_by)
    VALUES
      (entity_kind, NEW.id, NEW.store_id, change_action, NULL, to_jsonb(NEW), COALESCE(NEW.last_changed_by, 'system'));
    RETURN NEW;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    change_action := 'delete';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    change_action := 'restore';
  ELSE
    change_action := 'update';
  END IF;

  INSERT INTO inventory_change_history
    (entity_type, entity_id, store_id, action, before_data, after_data, changed_by)
  VALUES
    (entity_kind, NEW.id, NEW.store_id, change_action, to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.last_changed_by, OLD.last_changed_by, 'system'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_sku_history ON accounting_sku_master;
CREATE TRIGGER trg_accounting_sku_history
AFTER INSERT OR UPDATE ON accounting_sku_master
FOR EACH ROW EXECUTE FUNCTION record_inventory_change('sku');

DROP TRIGGER IF EXISTS trg_accounting_inbound_history ON accounting_inbound_shipments;
CREATE TRIGGER trg_accounting_inbound_history
AFTER INSERT OR UPDATE ON accounting_inbound_shipments
FOR EACH ROW EXECUTE FUNCTION record_inventory_change('inbound');
