-- 074_add_team_to_accounting_stores.sql
-- Add team and optional legal_entity text column to stores

ALTER TABLE stores ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'NCE';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS legal_entity TEXT;

-- Backfill existing stores
UPDATE stores SET team = 'NCE' WHERE team IS NULL OR team = '';
UPDATE stores SET legal_entity = 'NCE US LLC' WHERE legal_entity IS NULL AND legal_entity_id IS NOT NULL;
