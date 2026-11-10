#!/usr/bin/env bash
# Chuyển dữ liệu Postgres (docker volume ~25 GB) từ ổ chính sda (38 GB, đầy 89%) sang ổ trống sdb (40 GB).
# Chạy từ máy local:  bash scripts/server/move-postgres-to-sdb.sh
#
# Cách làm: format sdb → chép dữ liệu lúc DB còn chạy (không gián đoạn) → dừng app + DB → chép nốt phần thay đổi
# → MOUNT sdb ĐÈ LÊN đúng thư mục volume cũ → bật lại. compose.yaml / .env / code không đổi gì.
# Dữ liệu cũ vẫn nằm nguyên dưới điểm mount (sda) làm bản dự phòng; chạy ổn vài ngày rồi mới xoá:
#   bash scripts/server/move-postgres-to-sdb.sh --cleanup-old
# Docker được gắn RequiresMountsFor: nếu sdb không mount được lúc boot thì docker không chạy (app báo lỗi),
# thay vì Postgres âm thầm chạy trên bản cũ ở sda.
# Giữ khoá deploy trong lúc chạy → không ai deploy chồng. Dừng ~ vài phút (lần chép cuối chỉ phần thay đổi).
set -euo pipefail
SERVER="${SERVER:-root@167.233.26.87}"
MODE="${1:-move}"

ssh "$SERVER" "MODE='$MODE' bash -s" <<'REMOTE'
set -euo pipefail
APP=/var/www/amazon-listing
VOL=/var/lib/docker/volumes/amazon-listing_listing_desk_postgres/_data
DEV=/dev/sdb
NEW=/mnt/pgnew
psqlc() { docker exec amazon-listing-db-1 psql -U listing_desk -d listing_desk -Atc "$1"; }
counts() {
  psqlc "SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
    SELECT 'stores' t, count(*) n FROM stores UNION ALL
    SELECT 'accounting_orders', count(*) FROM accounting_orders UNION ALL
    SELECT 'accounting_sku_monthly', count(*) FROM accounting_sku_monthly UNION ALL
    SELECT 'accounting_sku_master', count(*) FROM accounting_sku_master UNION ALL
    SELECT 'schema_migrations', count(*) FROM schema_migrations) x"
}

if [ "$MODE" = "--cleanup-old" ]; then
  mountpoint -q "$VOL" || { echo "❌ $VOL chưa mount sdb — không xoá gì."; exit 1; }
  mkdir -p /mnt/rootview && mount --bind / /mnt/rootview
  echo "Dữ liệu cũ trên sda: $(du -sh /mnt/rootview$VOL | cut -f1)"
  rm -rf --one-file-system "/mnt/rootview$VOL"/* "/mnt/rootview$VOL"/.[!.]* 2>/dev/null || true
  umount /mnt/rootview
  df -h / | tail -1
  exit 0
fi

# Khoá deploy (cùng file với scripts/deploy-server.sh)
exec 9>/run/lock/amazon-listing-deploy.lock
flock -n 9 || { echo "❌ Đang có người deploy — chạy lại sau."; exit 1; }

# Kiểm tra an toàn: sdb phải trống hoàn toàn, volume chưa được mount
[ -b "$DEV" ] || { echo "❌ Không thấy $DEV"; exit 1; }
if [ -n "$(lsblk -no FSTYPE "$DEV" | tr -d '[:space:]')" ] || [ "$(lsblk -no NAME "$DEV" | wc -l)" -gt 1 ]; then
  echo "❌ $DEV đã có filesystem/phân vùng — dừng để không xoá nhầm dữ liệu."; lsblk -f "$DEV"; exit 1
fi
mountpoint -q "$VOL" && { echo "❌ $VOL đã là mount point — có vẻ đã chuyển rồi."; exit 1; }
[ -d "$VOL/base" ] || { echo "❌ Không thấy dữ liệu Postgres ở $VOL"; exit 1; }

echo "== 1. Format $DEV (ext4)"
mkfs.ext4 -q -L pgdata "$DEV"
mkdir -p "$NEW" && mount "$DEV" "$NEW"

echo "== 2. Chép lần 1 lúc DB còn chạy ($(du -sh "$VOL" | cut -f1))"
rsync -aHAX --delete "$VOL"/ "$NEW"/

echo "== 3. Dừng app + worker + DB"
pm2 stop all >/dev/null
sleep 3
BEFORE=$(counts)
echo "   Số dòng lúc dừng: $BEFORE"
cd "$APP" && docker compose stop db

echo "== 4. Chép nốt phần thay đổi"
rsync -aHAX --delete "$VOL"/ "$NEW"/
umount "$NEW"

echo "== 5. Mount sdb đè lên thư mục volume + fstab + docker phụ thuộc mount"
UUID=$(blkid -s UUID -o value "$DEV")
cp /etc/fstab "/etc/fstab.bak-$(date +%Y%m%d%H%M%S)"
echo "UUID=$UUID $VOL ext4 defaults,nofail 0 2" >> /etc/fstab
mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=%s\n' "$VOL" > /etc/systemd/system/docker.service.d/pgdata-mount.conf
systemctl daemon-reload
mount "$VOL"
mountpoint -q "$VOL" || { echo "❌ Mount lỗi — DB cũ còn nguyên ở sda, bật lại DB cũ"; docker compose start db; pm2 start all; exit 1; }

echo "== 6. Bật DB trên sdb"
docker compose start db
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' amazon-listing-db-1)" = healthy ] && break; sleep 2
done
AFTER=$(counts)
echo "   Số dòng sau khi chuyển: $AFTER"
if [ "$BEFORE" != "$AFTER" ]; then
  echo "⚠️ Số dòng khác (có thể do worker ghi giữa lần đếm và lúc dừng) — kiểm tra lại trước khi xoá dữ liệu cũ."
fi

echo "== 7. Bật app + worker"
pm2 start all >/dev/null
sleep 8
echo "App HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:2411/ || true)"
df -h / "$VOL" | sed 's/^/   /'
echo "✅ Xong. Dữ liệu cũ (~25 GB) vẫn ở sda làm dự phòng; ổn định vài ngày thì chạy với --cleanup-old."
REMOTE
