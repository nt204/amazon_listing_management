#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/config.env" ]; then
  # Sửa cấu hình cũ trước khi source; giá trị "Application Support" không quote
  # sẽ khiến bash hiểu phần sau dấu cách là một command và làm worker thoát.
  if grep -qE '^DOWNLOAD_BASE_DIR=.*(Downloads|Desktop|Application Support)' "$SCRIPT_DIR/config.env"; then
    sed -i '' 's|^DOWNLOAD_BASE_DIR=.*|DOWNLOAD_BASE_DIR=$HOME/AmazonPpcCrawler/downloads|' "$SCRIPT_DIR/config.env"
    echo "[CONFIG] Đã sửa DOWNLOAD_BASE_DIR thành \$HOME/AmazonPpcCrawler/downloads"
  fi
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

LOG_DIR="$HOME/Library/Logs"
MAX_LOG_MB="${MAX_LOG_MB:-20}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
CHECKPOINT_RETENTION_DAYS="${CHECKPOINT_RETENTION_DAYS:-30}"
ACCOUNTING_RETENTION_DAYS="${ACCOUNTING_RETENTION_DAYS:-30}"
MIN_FREE_DISK_GB="${MIN_FREE_DISK_GB:-10}"
SAFE_DOWNLOAD_ROOT="$HOME/AmazonPpcCrawler/downloads"
ACCOUNTING_DOWNLOAD_ROOT="$HOME/AmazonAccounting/downloads"
DOWNLOAD_ROOT="${DOWNLOAD_BASE_DIR:-$SAFE_DOWNLOAD_ROOT}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT/\$HOME/$HOME}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT/#\~/$HOME}"
case "$DOWNLOAD_ROOT" in
  "$HOME/Downloads"|"$HOME/Downloads/"*|"$HOME/Desktop"|"$HOME/Desktop/"*)
    echo "[MAINTENANCE] DOWNLOAD_BASE_DIR bị macOS bảo vệ; dùng $SAFE_DOWNLOAD_ROOT"
    DOWNLOAD_ROOT="$SAFE_DOWNLOAD_ROOT"
    ;;
esac
CHECKPOINT_ROOT="$HOME/Library/Application Support/AmazonPpcCrawler/jobs"

mkdir -p "$LOG_DIR" "$DOWNLOAD_ROOT" "$CHECKPOINT_ROOT" "$ACCOUNTING_DOWNLOAD_ROOT"

rotate_log() {
  local file="$1"
  [ -f "$file" ] || return 0
  local bytes max_bytes stamp
  bytes="$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)"
  max_bytes=$((MAX_LOG_MB * 1024 * 1024))
  if [ "$bytes" -ge "$max_bytes" ]; then
    stamp="$(date +%Y%m%d-%H%M%S)"
    mv "$file" "${file}.${stamp}"
    : > "$file"
  fi
}

rotate_log "$LOG_DIR/mac-crawler-worker.log"
rotate_log "$LOG_DIR/mac-crawler.log"
rotate_log "$LOG_DIR/mac-accounting.log"
find "$LOG_DIR" -type f \( -name 'mac-crawler-worker.log.*' -o -name 'mac-crawler.log.*' -o -name 'mac-accounting.log.*' \) -mtime "+$LOG_RETENTION_DAYS" -delete 2>/dev/null || true

# 1. Dọn dẹp tệp báo cáo cũ (PPC & Kế toán)
find "$DOWNLOAD_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$LOCAL_RETENTION_DAYS" -exec rm -rf -- {} + 2>/dev/null || true
find "$ACCOUNTING_DOWNLOAD_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$ACCOUNTING_RETENTION_DAYS" -exec rm -rf -- {} + 2>/dev/null || true
find "$CHECKPOINT_ROOT" -mindepth 1 -maxdepth 1 -type f -name '*.json' -mtime "+$CHECKPOINT_RETENTION_DAYS" -delete 2>/dev/null || true

# 2. Dọn tiến trình trình duyệt mồ côi nếu không có profile nào đang hoạt động
if [ -z "$(pgrep -f 'tsx.*accounting_crawler' 2>/dev/null || true)" ] && [ -z "$(pgrep -f 'tsx.*crawler\.ts' 2>/dev/null || true)" ]; then
  ACTIVE_PORTS="$(curl -s http://127.0.0.1:50325/api/v1/browser/local-active 2>/dev/null | grep -o '\"debug_port\"' || true)"
  if [ -z "$ACTIVE_PORTS" ]; then
    pkill -9 -f SunBrowser 2>/dev/null || true
  fi
fi

# 3. Tự động giải phóng RAM hệ thống (purge cache/inactive memory)
if command -v sudo >/dev/null 2>&1; then
  sudo -n purge 2>/dev/null && echo "[MAINTENANCE] Đã giải phóng RAM hệ thống (sudo purge thành công)." || true
fi

available_kb="$(df -Pk "$DOWNLOAD_ROOT" 2>/dev/null | awk 'NR==2 {print $4}' || echo 99999999)"
required_kb=$((MIN_FREE_DISK_GB * 1024 * 1024))
if [ -n "$available_kb" ] && [ "$available_kb" -lt "$required_kb" ] 2>/dev/null; then
  echo "[DISK GUARD] Cần tối thiểu ${MIN_FREE_DISK_GB}GB trống tại $DOWNLOAD_ROOT; hiện không đủ." >&2
  exit 1
fi

echo "[MAINTENANCE] Log/retention/RAM ổn; dung lượng trống đáp ứng tối thiểu ${MIN_FREE_DISK_GB}GB."
