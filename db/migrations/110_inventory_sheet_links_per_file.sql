-- 110_inventory_sheet_links_per_file.sql
-- Mỗi store lưu link theo FILE thay vì theo từng tab:
--   'inventory' = file "<STORE> INVENTORY" (tab BẢNG MÃ + CHI TIẾT ĐI HÀNG) — store có team FBA
--   'fbm'       = file "BẢNG MÃ FBM" (tab FBM_<Store>)                    — store có team FBM

ALTER TABLE inventory_sheet_links DROP CONSTRAINT IF EXISTS inventory_sheet_links_sheet_type_check;
ALTER TABLE inventory_sheet_links RENAME COLUMN sheet_type TO link_type;

-- Chuyển link cũ (nếu có): 'sku' / 'inbound' → 'inventory' (giữ 1 dòng mỗi store), 'sku_fbm' → 'fbm'
UPDATE inventory_sheet_links SET link_type = 'inventory' WHERE link_type = 'sku';
UPDATE inventory_sheet_links AS l SET link_type = 'inventory'
WHERE l.link_type = 'inbound'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_sheet_links x WHERE x.store_id = l.store_id AND x.link_type = 'inventory'
  );
DELETE FROM inventory_sheet_links WHERE link_type = 'inbound';
UPDATE inventory_sheet_links SET link_type = 'fbm' WHERE link_type = 'sku_fbm';

ALTER TABLE inventory_sheet_links
  ADD CONSTRAINT inventory_sheet_links_link_type_check CHECK (link_type IN ('inventory', 'fbm'));

-- last_result giờ lưu kết quả theo từng phần: {"parts": {"sku": {...}, "inbound": {...}}}
UPDATE inventory_sheet_links SET last_result = NULL;
