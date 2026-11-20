#!/usr/bin/env bash
# Kéo toàn bộ DB production (VPS) về Postgres Docker local (localhost:2412).
#
# - pg_dump đọc cả ppc_performance_facts (~23 GB) → CHỈ chạy 22h–2h giờ VN (AGENTS.md: không quét facts 7h–22h;
#   2h có cron dọn facts, 3h–5h có ppc-ingestion-worker). Ngoài khung giờ thì script tự dừng.
# - Dump stream thẳng qua SSH về máy Mac (không ghi file trên VPS — ổ VPS chỉ còn ~27 GB).
# - Restore vào DB mới listing_desk_prod, xong mới đổi tên: DB local cũ giữ lại thành listing_desk_old_<ngày>.
#   Restore lỗi thì DB local hiện tại không bị đụng.
#
# Dùng: bash scripts/pull-prod-db.sh            (tắt next dev trước khi chạy — cần đổi tên DB)
#       DUMP_FILE=~/prod_dumps/x.dump bash scripts/pull-prod-db.sh   (restore lại từ file đã kéo, không kéo lại)
set -euo pipefail

VPS="${VPS:-root@167.233.26.87}"
PROD_CONTAINER="amazon-listing-db-1"
LOCAL_CONTAINER="amazon-listing-db-1"
DB_USER="listing_desk"
DB_NAME="listing_desk"
STAMP="$(date +%Y%m%d)"
DUMP_DIR="${DUMP_DIR:-$HOME/prod_dumps}"
DUMP_FILE="${DUMP_FILE:-}"

cd "$(dirname "$0")/.."

if [ -z "$DUMP_FILE" ]; then
  VN_HOUR="$(TZ=Asia/Ho_Chi_Minh date +%H)"
  case "$VN_HOUR" in
    22|23|00|01) ;;
    *) echo "⛔ Bây giờ ${VN_HOUR}h giờ VN — chỉ được dump production 22h–2h (AGENTS.md)." >&2; exit 1 ;;
  esac

  mkdir -p "$DUMP_DIR"
  DUMP_FILE="$DUMP_DIR/prod_${STAMP}.dump"
  echo ">>> [1/3] Đang dump production → $DUMP_FILE (stream qua SSH)…"
  ssh -o ServerAliveInterval=30 "$VPS" \
    "docker exec $PROD_CONTAINER pg_dump -U $DB_USER -d $DB_NAME -Fc -Z 6" > "$DUMP_FILE.part"
  mv "$DUMP_FILE.part" "$DUMP_FILE"
  echo "    Xong: $(du -h "$DUMP_FILE" | cut -f1)"
fi

psql_local() { docker exec "$LOCAL_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -Atc "$1"; }

echo ">>> [2/3] Restore vào DB tạm listing_desk_prod…"
psql_local "DROP DATABASE IF EXISTS listing_desk_prod"
psql_local "CREATE DATABASE listing_desk_prod OWNER $DB_USER"
docker cp "$DUMP_FILE" "$LOCAL_CONTAINER:/tmp/prod.dump"
docker exec "$LOCAL_CONTAINER" pg_restore -U "$DB_USER" -d listing_desk_prod --no-owner --no-privileges -j 4 /tmp/prod.dump
docker exec "$LOCAL_CONTAINER" rm -f /tmp/prod.dump

echo ">>> [3/3] Đổi DB: listing_desk → listing_desk_old_${STAMP}, listing_desk_prod → listing_desk…"
psql_local "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB_NAME', 'listing_desk_prod') AND pid <> pg_backend_pid()" >/dev/null
psql_local "ALTER DATABASE $DB_NAME RENAME TO listing_desk_old_${STAMP}"
psql_local "ALTER DATABASE listing_desk_prod RENAME TO $DB_NAME"

# Migration mới chưa lên production (vd. 160) chạy thêm trên bản local
npm run db:migrate

echo "✅ DB local đã là bản production ${STAMP}. DB cũ: listing_desk_old_${STAMP} (xoá khi không cần: DROP DATABASE listing_desk_old_${STAMP})."
