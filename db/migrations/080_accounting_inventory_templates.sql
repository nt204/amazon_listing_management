-- 080_accounting_inventory_templates.sql
-- Tự động lưu template Excel gốc khi Import để Xuất file giữ nguyên 100% cấu trúc, format, công thức

CREATE TABLE IF NOT EXISTS accounting_inventory_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('sku', 'inbound', 'all')),
  file_name TEXT,
  file_buffer BYTEA NOT NULL,
  has_sku_sheet BOOLEAN NOT NULL DEFAULT false,
  has_inbound_sheet BOOLEAN NOT NULL DEFAULT false,
  sheet_names TEXT[] NOT NULL DEFAULT '{}',
  file_size INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounting_inventory_template UNIQUE (store_id, template_type)
);

CREATE INDEX IF NOT EXISTS idx_accounting_inventory_templates_store 
  ON accounting_inventory_templates (store_id, template_type);
