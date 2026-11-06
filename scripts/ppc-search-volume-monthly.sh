#!/bin/bash
# scripts/ppc-search-volume-monthly.sh
# Đồng bộ Search Volume (Helium 10) cho TẤT CẢ store, 1 lần/tháng — chạy trên VPS production.
# Crontab của root trên VPS (giờ server = +07):
#   0 3 3 * * /bin/bash /var/www/amazon-listing/scripts/ppc-search-volume-monthly.sh >> /var/log/ppc_search_volume.log 2>&1
# Chạy tiến trình riêng với ưu tiên CPU/IO thấp để không ảnh hưởng web app.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Không chạy chồng nếu lượt trước còn đang chạy (lượt dài nhất ~vài giờ)
exec 9>/tmp/ppc-search-volume-monthly.lock
if ! flock -n 9; then
  echo "[$(date '+%F %T')] Lượt trước vẫn đang chạy, bỏ qua."
  exit 0
fi

nice -n 10 ionice -c3 npm run --silent ppc:sync-search-volume
