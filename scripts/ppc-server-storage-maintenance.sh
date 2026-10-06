#!/bin/bash
set -euo pipefail

DB_CONTAINER="${PPC_DB_CONTAINER:-amazon-listing-db-1}"
DB_USER="${PPC_DB_USER:-listing_desk}"
DB_NAME="${PPC_DB_NAME:-listing_desk}"
KEEP_ALL_GRAINS_DAYS="${PPC_DB_KEEP_ALL_GRAINS_DAYS:-3}"
KEEP_TARGET_DAYS="${PPC_DB_KEEP_TARGET_DAYS:-8}"
LOCK_FILE="/var/lock/ppc-storage-maintenance.lock"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

if ! [[ "$KEEP_ALL_GRAINS_DAYS" =~ ^[0-9]+$ ]] || (( KEEP_ALL_GRAINS_DAYS < 1 )); then
  echo "PPC_DB_KEEP_ALL_GRAINS_DAYS must be an integer >= 1." >&2
  exit 1
fi

if ! [[ "$KEEP_TARGET_DAYS" =~ ^[0-9]+$ ]] || (( KEEP_TARGET_DAYS < KEEP_ALL_GRAINS_DAYS )); then
  echo "PPC_DB_KEEP_TARGET_DAYS must be an integer >= KEEP_ALL_GRAINS_DAYS." >&2
  exit 1
fi

psql_cmd=(docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME")

echo "[PPC Storage] Bắt đầu kiểm tra retention theo chính sách:"
echo "  - 1..$KEEP_ALL_GRAINS_DAYS ngày gần nhất: giữ tất cả grain."
echo "  - $((KEEP_ALL_GRAINS_DAYS + 1))..$KEEP_TARGET_DAYS ngày: giữ grain TARGET (tỉa grain khác)."
echo "  - Sau ngày $KEEP_TARGET_DAYS: chỉ giữ range còn cần cho outcome (bảo vệ baseline, 3D, 7D, cả hai nửa 7D của 14D, 30D)."

# 1. Tỉa các grain khác TARGET cho ngày từ (KEEP_ALL_GRAINS_DAYS + 1) đến KEEP_TARGET_DAYS
mapfile -t trim_target_days < <("${psql_cmd[@]}" -At <<SQL
WITH ranked_days AS (
  SELECT snapshot_date,
         dense_rank() OVER (ORDER BY snapshot_date DESC) AS recency_rank
  FROM (SELECT DISTINCT snapshot_date FROM ppc_performance_facts) days
)
SELECT snapshot_date
FROM ranked_days
WHERE recency_rank BETWEEN $((KEEP_ALL_GRAINS_DAYS + 1)) AND $KEEP_TARGET_DAYS
ORDER BY snapshot_date;
SQL
)

for d in "${trim_target_days[@]}"; do
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  has_non_target=$("${psql_cmd[@]}" -Atc "SELECT 1 FROM ppc_performance_facts WHERE snapshot_date = DATE '$d' AND grain != 'TARGET' LIMIT 1;")
  if [[ "$has_non_target" == "1" ]]; then
    echo "[PPC Storage] Tỉa grain non-TARGET cho snapshot ngày 4-8: $d"
    "${psql_cmd[@]}" -Atc "DELETE FROM ppc_performance_facts WHERE snapshot_date = DATE '$d' AND grain != 'TARGET';"
    "${psql_cmd[@]}" -c "CHECKPOINT;" >/dev/null
  fi
done

# 2. Xử lý các ngày sau KEEP_TARGET_DAYS (> 8 ngày):
# Chỉ giữ các snapshot/range còn cần cho outcome
mapfile -t old_candidates < <("${psql_cmd[@]}" -At <<SQL
WITH ranked_days AS (
  SELECT snapshot_date,
         dense_rank() OVER (ORDER BY snapshot_date DESC) AS recency_rank
  FROM (SELECT DISTINCT snapshot_date FROM ppc_performance_facts) days
), pending_ranges AS (
  SELECT DISTINCT
         COALESCE(action.approved_at::date, action.created_at::date) AS applied_on,
         outcome.window_days,
         outcome.observation_start,
         outcome.observation_end
  FROM ppc_action_outcomes outcome
  JOIN ppc_actions action ON action.id = outcome.action_id
  WHERE outcome.status IN ('OBSERVING', 'PROVISIONAL', 'INSUFFICIENT_DATA')
), protected_snapshots AS (
  SELECT DISTINCT fact.snapshot_date
  FROM ppc_performance_facts fact
  JOIN pending_ranges pending ON (
    -- Baseline 30D (30 ngày trước khi action áp dụng)
    (fact.report_start_date = pending.applied_on - 30 AND fact.report_end_date = pending.applied_on)
    OR
    -- Mốc chuẩn (3D, 7D, 30D sau action)
    (fact.report_start_date = pending.observation_start AND fact.report_end_date = pending.observation_end)
    OR
    -- Mốc 14D: nửa 1 (7 ngày đầu)
    (pending.window_days = 14 AND fact.report_start_date = pending.observation_start AND fact.report_end_date = pending.observation_start + 7)
    OR
    -- Mốc 14D: nửa 2 (7 ngày sau)
    (pending.window_days = 14 AND fact.report_start_date = pending.observation_start + 7 AND fact.report_end_date = pending.observation_end)
  )
)
SELECT ranked.snapshot_date,
       CASE WHEN protected.snapshot_date IS NOT NULL THEN 'PROTECTED' ELSE 'DELETE' END AS action_type
FROM ranked_days ranked
LEFT JOIN protected_snapshots protected ON protected.snapshot_date = ranked.snapshot_date
WHERE ranked.recency_rank > $KEEP_TARGET_DAYS
ORDER BY ranked.snapshot_date;
SQL
)

for entry in "${old_candidates[@]}"; do
  [[ -n "$entry" ]] || continue
  snapshot_date="${entry%|*}"
  action_type="${entry#*|}"
  [[ "$snapshot_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue

  if [[ "$action_type" == "DELETE" ]]; then
    echo "[PPC Storage] Xóa hoàn toàn snapshot cũ không cần cho outcome: $snapshot_date"
    "${psql_cmd[@]}" -Atc "DELETE FROM ppc_performance_facts WHERE snapshot_date = DATE '$snapshot_date';"
    "${psql_cmd[@]}" -c "CHECKPOINT;" >/dev/null
  elif [[ "$action_type" == "PROTECTED" ]]; then
    has_non_target=$("${psql_cmd[@]}" -Atc "SELECT 1 FROM ppc_performance_facts WHERE snapshot_date = DATE '$snapshot_date' AND grain != 'TARGET' LIMIT 1;")
    if [[ "$has_non_target" == "1" ]]; then
      echo "[PPC Storage] Snapshot được bảo vệ cho outcome $snapshot_date: dọn dẹp non-TARGET, chỉ giữ TARGET"
      "${psql_cmd[@]}" -Atc "DELETE FROM ppc_performance_facts WHERE snapshot_date = DATE '$snapshot_date' AND grain != 'TARGET';"
      "${psql_cmd[@]}" -c "CHECKPOINT;" >/dev/null
    fi
  fi
done

# Standard VACUUM keeps the table reusable without requiring a second 18+ GB copy.
echo "[PPC Storage] Chạy VACUUM ANALYZE để thu dọn không gian lưu trữ..."
"${psql_cmd[@]}" -c "VACUUM (ANALYZE, PARALLEL 0) ppc_performance_facts;"
echo "[PPC Storage] Hoàn tất dọn dẹp theo chính sách lưu trữ đa tầng."
