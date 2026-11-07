-- Guard đĩa khi nạp Bulk PPC (lib/ppc/service.ts) đọc pgstattuple_approx để tính chỗ trống tái sử dụng được trong
-- ppc_performance_facts. Môi trường không có contrib pgstattuple thì bỏ qua — guard tự lùi về chỉ đếm đĩa trống.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgstattuple;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pgstattuple không có sẵn: %', SQLERRM;
END $$;
