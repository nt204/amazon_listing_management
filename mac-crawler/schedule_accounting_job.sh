#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ketoan.crawler.plist"
SOURCE_PLIST="$SCRIPT_DIR/$PLIST_NAME"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"

mkdir -p "$TARGET_DIR" "$LOG_DIR"

SCHEDULE_TIME="${1:-14:30}"

if [[ ! "$SCHEDULE_TIME" =~ ^[0-9]{1,2}:[0-9]{2}$ ]]; then
  echo "Lỗi: Giờ chạy không hợp lệ '$SCHEDULE_TIME'. Định dạng chuẩn là HH:MM (ví dụ 07:00)." >&2
  exit 1
fi

SCHEDULE_HOUR=$(echo "$SCHEDULE_TIME" | cut -d: -f1)
SCHEDULE_MINUTE=$(echo "$SCHEDULE_TIME" | cut -d: -f2)
SCHEDULE_HOUR=$((10#$SCHEDULE_HOUR))
SCHEDULE_MINUTE=$((10#$SCHEDULE_MINUTE))

echo "============================================================"
echo "CÀI ĐẶT LỊCH CHẠY TỰ ĐỘNG TẢI FILE KẾ TOÁN TRÊN MAC MINI"
echo "Giờ chạy: $(printf "%02d:%02d" "$SCHEDULE_HOUR" "$SCHEDULE_MINUTE") mỗi ngày"
echo "============================================================"

# Gỡ bỏ service cũ nếu đang chạy
if launchctl list | grep -q "com.amazon.ketoan.crawler"; then
  echo "[1/4] Gỡ bỏ lịch chạy cũ..."
  launchctl bootout "gui/$(id -u)/com.amazon.ketoan.crawler" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

# Cập nhật plist theo key, không phụ thuộc vào giá trị giờ/phút có sẵn trong template.
cp "$SOURCE_PLIST" "$TARGET_PLIST"
plutil -replace Hour -integer "$SCHEDULE_HOUR" "$TARGET_PLIST"
plutil -replace Minute -integer "$SCHEDULE_MINUTE" "$TARGET_PLIST"

chmod 644 "$TARGET_PLIST"
echo "[2/4] Đã cấu hình: $TARGET_PLIST"

# Đăng ký lại service vào launchd
echo "[3/4] Đăng ký LaunchAgent với hệ điều hành..."
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST" 2>/dev/null || launchctl load -w "$TARGET_PLIST"

echo "[4/4] Kiểm tra trạng thái service..."
if launchctl list | grep -q "com.amazon.ketoan.crawler"; then
  echo "✅ THÀNH CÔNG: Lịch chạy tải file kế toán đã sẵn sàng lúc $(printf "%02d:%02d" "$SCHEDULE_HOUR" "$SCHEDULE_MINUTE") hàng ngày!"
  echo "Xem log hoạt động tại: tail -f ~/Library/Logs/mac-accounting.log"
else
  echo "⚠️ Cảnh báo: Service chưa hiển thị trong launchctl list."
fi
