#!/bin/bash
set -euo pipefail

# Script chạy tự động lúc 14:00 Thứ 2 hàng tuần để gửi Báo cáo KPI Tuần vào nhóm Lark
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Cron Monday 14:00] Bắt đầu gửi báo cáo KPI tuần qua Lark..."
cd /var/www/amazon-listing

# Chạy script gửi báo cáo KPI tuần
node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/send-weekly-kpi-report.ts --ping-lark

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Cron Monday 14:00] Hoàn thành gửi báo cáo KPI tuần."
