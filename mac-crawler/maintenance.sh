#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

LOG_DIR="$HOME/Library/Logs"
MAX_LOG_MB="${MAX_LOG_MB:-20}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-14}"
CHECKPOINT_RETENTION_DAYS="${CHECKPOINT_RETENTION_DAYS:-30}"
MIN_FREE_DISK_GB="${MIN_FREE_DISK_GB:-10}"
DOWNLOAD_ROOT="${DOWNLOAD_BASE_DIR:-$HOME/Downloads/Bulk file}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT/\$HOME/$HOME}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT/#\~/$HOME}"
CHECKPOINT_ROOT="$HOME/Library/Application Support/AmazonPpcCrawler/jobs"

mkdir -p "$LOG_DIR" "$DOWNLOAD_ROOT" "$CHECKPOINT_ROOT"

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
find "$LOG_DIR" -type f \( -name 'mac-crawler-worker.log.*' -o -name 'mac-crawler.log.*' \) -mtime "+$LOG_RETENTION_DAYS" -delete

# Chỉ dọn nội dung trong hai thư mục crawler đã resolve cụ thể.
find "$DOWNLOAD_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$LOCAL_RETENTION_DAYS" -exec rm -rf -- {} +
find "$CHECKPOINT_ROOT" -mindepth 1 -maxdepth 1 -type f -name '*.json' -mtime "+$CHECKPOINT_RETENTION_DAYS" -delete

available_kb="$(df -Pk "$DOWNLOAD_ROOT" | awk 'NR==2 {print $4}')"
required_kb=$((MIN_FREE_DISK_GB * 1024 * 1024))
if [ -z "$available_kb" ] || [ "$available_kb" -lt "$required_kb" ]; then
  echo "[DISK GUARD] Cần tối thiểu ${MIN_FREE_DISK_GB}GB trống tại $DOWNLOAD_ROOT; hiện không đủ." >&2
  exit 1
fi

echo "[MAINTENANCE] Log/retention ổn; dung lượng trống đáp ứng tối thiểu ${MIN_FREE_DISK_GB}GB."
