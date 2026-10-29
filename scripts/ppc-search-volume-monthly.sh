#!/bin/bash
# scripts/ppc-search-volume-monthly.sh
# Lên lịch chạy đồng bộ Search Volume tự động 1 tháng / 1 lần vào lúc 03:00 sáng ngày mùng 3 hàng tháng
# Crontab:
# 0 3 3 * * /Users/macbook/Desktop/Amazon\ Listing\ Management/scripts/ppc-search-volume-monthly.sh >> /Users/macbook/Desktop/Amazon\ Listing\ Management/ppc-search-volume-monthly.log 2>&1

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=========================================================="
echo "⏰ [$(date '+%Y-%m-%d %H:%M:%S')] Bắt đầu Job đồng bộ Search Volume hàng tháng (Ngày 03 hàng tháng)"
echo "=========================================================="

# Chạy đồng bộ Search Volume cho các store
npm run ppc:sync-search-volume
npm run ppc:sync-search-volume:limima

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Kết thúc Job thành công."
