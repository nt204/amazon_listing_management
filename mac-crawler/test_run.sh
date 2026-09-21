#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "CHẠY THỬ NGHIỆM TIẾN TRÌNH MAC CRAWLER (TEST RUN)"
echo "============================================================"
echo "Lệnh này sẽ thực thi ngay lập tức toàn bộ chu trình:"
echo " 1. Crawl 6 file PPC qua AdsPower"
echo " 2. Upload file lên Cloudflare R2"
echo " 3. Kích hoạt Web App đồng bộ vào PostgreSQL"
echo "============================================================"

bash "$SCRIPT_DIR/run_daily.sh"
