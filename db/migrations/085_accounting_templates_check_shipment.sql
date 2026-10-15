-- 085_accounting_templates_check_shipment.sql
-- Cho phép template_type nhận 'check_shipment'

ALTER TABLE accounting_inventory_templates DROP CONSTRAINT IF EXISTS accounting_inventory_templates_template_type_check;
ALTER TABLE accounting_inventory_templates ADD CONSTRAINT accounting_inventory_templates_template_type_check 
  CHECK (template_type IN ('sku', 'inbound', 'check_shipment', 'all'));

ALTER TABLE accounting_inventory_templates 
  ADD COLUMN IF NOT EXISTS has_check_shipment_sheet BOOLEAN NOT NULL DEFAULT false;
