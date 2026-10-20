-- Preserve source-workbook precision for imported monthly base-cost snapshots.
ALTER TABLE accounting_monthly_base_cost
  ALTER COLUMN basecost_dau_ky TYPE NUMERIC(18, 9),
  ALTER COLUMN gtri_ton_dau_ky TYPE NUMERIC(20, 9),
  ALTER COLUMN gtri_nhap TYPE NUMERIC(20, 9),
  ALTER COLUMN don_gia_nhap_tb TYPE NUMERIC(18, 9),
  ALTER COLUMN tong_gtri_kha_dung TYPE NUMERIC(20, 9),
  ALTER COLUMN basecost_thang TYPE NUMERIC(18, 9);
