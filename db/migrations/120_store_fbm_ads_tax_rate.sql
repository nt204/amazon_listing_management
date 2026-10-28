-- 120_store_fbm_ads_tax_rate.sql
-- Thuế FBM = (thuế Ads) × Ads Fee + 10% AMZ Fee + 1% Revenue. Mặc định thuế Ads 10% (như FASTPEACE);
-- EVERPHANT và EKASPEEK không chịu thuế 10% Ads (kế toán xác nhận 28/10/2026).

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS fbm_ads_tax_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.10;

UPDATE stores SET fbm_ads_tax_rate = 0 WHERE UPPER(TRIM(name)) IN ('EVERPHANT', 'EKASPEEK');
