#!/usr/bin/env bash
# Kéo về DB local (localhost:2412) các bản báo cáo PPC mà ppc_active_snapshots local đang trỏ tới nhưng local chưa có facts
# (local đồng bộ con trỏ nhưng thiếu facts → Manual Bid / các tab PPC local trống).
#
# Đọc production theo kiểu nhẹ (AGENTS.md): mỗi lượt chỉ 1 store × 1 kỳ báo cáo × 1 ad_type × 1 grain, đi theo index
# ppc_performance_scope_idx, statement_timeout 30s, chạy lần lượt có nghỉ. Lượt nào quá 30s thì chia nhỏ theo campaign.
#
# Dùng: bash scripts/pull-prod-ppc-facts.sh                 (mọi store, mọi kỳ còn thiếu)
#       STORE=FASTPEACE DAYS=30 bash scripts/pull-prod-ppc-facts.sh
set -euo pipefail

VPS="${VPS:-root@167.233.26.87}"
CONTAINER="amazon-listing-db-1"
TIMEOUT="${TIMEOUT:-30s}"
PAUSE="${PAUSE:-2}"
STORE="${STORE:-}"
DAYS="${DAYS:-}"
GRAINS=(CAMPAIGN AD_GROUP PRODUCT PLACEMENT TARGET SEARCH_TERM KEYWORD AD)

local_sql() { docker exec -i "$CONTAINER" psql -U listing_desk -d listing_desk -v ON_ERROR_STOP=1 -Atq "$@"; }
prod_copy() {
  # $1 = câu SELECT; stream COPY TO STDOUT từ production
  ssh -n -o ServerAliveInterval=30 "$VPS" \
    "docker exec -i $CONTAINER psql -U listing_desk -d listing_desk -v ON_ERROR_STOP=1 -Atq -c \"SET statement_timeout='$TIMEOUT'\" -c \"COPY ($1) TO STDOUT\""
}

COLS="$(local_sql -c "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='ppc_performance_facts'")"

# Kỳ báo cáo đang active ở local mà local chưa có dòng facts nào
TARGETS="$(local_sql -c "
  SELECT a.store_id || '|' || s.name || '|' || a.coverage_days || '|' || a.report_start_date || '|' || a.report_end_date
  FROM ppc_active_snapshots a JOIN ppc_stores s ON s.id = a.store_id
  WHERE ('${STORE}' = '' OR upper(s.name) = upper('${STORE}'))
    AND ('${DAYS}' = '' OR a.coverage_days::text = '${DAYS}')
    AND NOT EXISTS (
      SELECT 1 FROM ppc_performance_facts f
      WHERE f.store_id = a.store_id AND f.report_start_date = a.report_start_date AND f.report_end_date = a.report_end_date
    )
  ORDER BY (s.name = 'FASTPEACE') DESC, s.name, a.coverage_days DESC")"

if [ -z "$TARGETS" ]; then echo "✅ Local không thiếu kỳ báo cáo active nào."; exit 0; fi
echo "Kỳ còn thiếu:"; echo "$TARGETS" | sed 's/^/  /'

pull_chunk() {
  # $1 store_id, $2 start, $3 end, $4 ad_type, $5 grain, $6 điều kiện thêm (tuỳ chọn)
  local where="store_id='$1' AND report_start_date='$2' AND report_end_date='$3' AND ad_type='$4' AND grain='$5' ${6:-}"
  local tmp; tmp="$(mktemp)"
  if prod_copy "SELECT $COLS FROM ppc_performance_facts WHERE $where" > "$tmp" 2> "$tmp.err"; then
    local n; n=$(wc -l < "$tmp" | tr -d ' ')
    if [ "$n" -gt 0 ]; then
      local_sql -c "\\copy ppc_performance_facts ($COLS) FROM STDIN" < "$tmp"
    fi
    rm -f "$tmp" "$tmp.err"; echo "$n"; return 0
  fi
  if grep -q "statement timeout" "$tmp.err"; then rm -f "$tmp" "$tmp.err"; echo "TIMEOUT"; return 0; fi
  cat "$tmp.err" >&2; rm -f "$tmp" "$tmp.err"; return 1
}

while IFS='|' read -r SID NAME COV START END; do
  [ -z "$SID" ] && continue
  echo ">>> $NAME ${COV}d ($START → $END)"
  TOTAL=0
  for AD in SP SB SD; do
    for G in "${GRAINS[@]}"; do
      R="$(pull_chunk "$SID" "$START" "$END" "$AD" "$G")"
      if [ "$R" = "TIMEOUT" ]; then
        # Chia 8 phần theo campaign_id
        for K in 0 1 2 3 4 5 6 7; do
          R2="$(pull_chunk "$SID" "$START" "$END" "$AD" "$G" "AND abs(hashtext(campaign_id)) % 8 = $K")"
          if [ "$R2" = "TIMEOUT" ]; then echo "  ⛔ $AD/$G phần $K vẫn quá $TIMEOUT — bỏ qua, chạy lại ngoài giờ." >&2; continue; fi
          TOTAL=$((TOTAL + R2)); sleep "$PAUSE"
        done
        echo "  $AD/$G: chia nhỏ xong"
      elif [ "$R" -gt 0 ]; then
        TOTAL=$((TOTAL + R)); echo "  $AD/$G: $R dòng"
      fi
      sleep "$PAUSE"
    done
  done
  echo "  = $TOTAL dòng"
done <<< "$TARGETS"

local_sql -c "ANALYZE ppc_performance_facts"
echo "✅ Xong."
