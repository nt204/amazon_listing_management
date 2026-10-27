-- 116_sku_economics_max_bid_override.sql
-- Max Bid nhập tay cho từng SKU. NULL = dùng Max Bid tự tính (CR × Profit Before Ads).
ALTER TABLE sku_economics
  ADD COLUMN IF NOT EXISTS max_bid_override NUMERIC(10, 2);
