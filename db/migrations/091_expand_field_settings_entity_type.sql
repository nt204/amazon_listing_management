-- Migration: Allow 'check_shipment' and 'orders' in accounting_inventory_field_settings
ALTER TABLE accounting_inventory_field_settings
  DROP CONSTRAINT IF EXISTS accounting_inventory_field_settings_entity_type_check;

ALTER TABLE accounting_inventory_field_settings
  ADD CONSTRAINT accounting_inventory_field_settings_entity_type_check
  CHECK (entity_type IN ('sku', 'inbound', 'check_shipment', 'orders'));
