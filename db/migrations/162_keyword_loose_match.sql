-- Khớp keyword bỏ qua dấu nháy: Amazon ghi "mother's gifts", Helium 10 thường trả "mothers gifts" (có lúc giữ dấu nháy).
-- lib/ppc/search-volume.ts khớp nguyên văn trước, không có số thì khớp theo kw_loose().
-- Phải giữ đúng bộ ký tự với looseKeyword() trong lib/ppc/search-volume.ts.
CREATE OR REPLACE FUNCTION kw_loose(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT translate(t, '''’‘`´', '') $$;

CREATE INDEX IF NOT EXISTS keyword_search_volumes_loose_idx
  ON keyword_search_volumes (marketplace, kw_loose(keyword_norm));

CREATE INDEX IF NOT EXISTS ppc_asin_keyword_rankings_loose_idx
  ON ppc_asin_keyword_rankings (marketplace, asin, kw_loose(keyword_norm));
