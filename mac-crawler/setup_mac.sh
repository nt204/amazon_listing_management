#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/config.env" ]; then
  cp "$SCRIPT_DIR/config.env.example" "$SCRIPT_DIR/config.env"
  chmod 600 "$SCRIPT_DIR/config.env"
  echo "[CẦN CẤU HÌNH] Đã tạo config.env. Hãy điền R2, WEB_APP và AdsPower rồi chạy lại setup_mac.sh."
  exit 1
fi

# Sửa cấu hình path cũ trước khi source để tránh lỗi bash tại dấu cách.
if grep -qE '^DOWNLOAD_BASE_DIR=.*(Downloads|Desktop|Application Support)' "$SCRIPT_DIR/config.env"; then
  sed -i '' 's|^DOWNLOAD_BASE_DIR=.*|DOWNLOAD_BASE_DIR=$HOME/AmazonPpcCrawler/downloads|' "$SCRIPT_DIR/config.env"
  echo "[CONFIG] Đã sửa DOWNLOAD_BASE_DIR thành \$HOME/AmazonPpcCrawler/downloads"
fi

echo "============================================================"

set -a
source "$SCRIPT_DIR/config.env"
set +a
for REQUIRED_VAR in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY WEB_APP_URL WEB_APP_AUTH_TOKEN; do
  if [ -z "${!REQUIRED_VAR:-}" ]; then
    echo "[LỖI]: config.env còn thiếu $REQUIRED_VAR. Setup dừng để tránh cài worker restart-loop."
    exit 1
  fi
done

# LaunchAgent không được macOS cấp quyền truy cập Desktop/Downloads theo mặc định.
# Tự sửa cấu hình cũ để worker không rơi vào crash-loop "Operation not permitted".
EXPANDED_DOWNLOAD_DIR="${DOWNLOAD_BASE_DIR:-}"
EXPANDED_DOWNLOAD_DIR="${EXPANDED_DOWNLOAD_DIR/\$HOME/$HOME}"
EXPANDED_DOWNLOAD_DIR="${EXPANDED_DOWNLOAD_DIR/#\~/$HOME}"
case "$EXPANDED_DOWNLOAD_DIR" in
  "$HOME/Downloads"|"$HOME/Downloads/"*|"$HOME/Desktop"|"$HOME/Desktop/"*)
    SAFE_DOWNLOAD_VALUE='$HOME/AmazonPpcCrawler/downloads'
    sed -i '' "s|^DOWNLOAD_BASE_DIR=.*|DOWNLOAD_BASE_DIR=$SAFE_DOWNLOAD_VALUE|" "$SCRIPT_DIR/config.env"
    export DOWNLOAD_BASE_DIR="$HOME/AmazonPpcCrawler/downloads"
    echo "[CONFIG] Đã chuyển DOWNLOAD_BASE_DIR khỏi thư mục macOS bảo vệ sang: $DOWNLOAD_BASE_DIR"
    ;;
esac
echo "    SETUP HỆ THỐNG MAC CRAWLER TỰ ĐỘNG CHO MAC MINI M1     "
echo "============================================================"

# 1. Cấp quyền thực thi cho toàn bộ script
echo "[1/5] Cấp quyền thực thi các file script..."
chmod +x "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/*.py 2>/dev/null || true
chmod 600 "$SCRIPT_DIR/config.env" 2>/dev/null || true

# 2. Kiểm tra môi trường Node.js & npm
echo "[2/5] Kiểm tra môi trường Node.js & npm..."
if ! command -v node >/dev/null 2>&1; then
  echo "[LỖI]: Chưa tìm thấy Node.js trên máy Mac này!"
  echo "Vui lòng cài Node.js bằng cách tải từ https://nodejs.org hoặc chạy: brew install node"
  exit 1
fi
echo "      -> Node.js phiên bản: $(node -v)"
echo "      -> npm phiên bản: $(npm -v)"

# 3. Cài đặt thư viện Node.js độc lập (chỉ mất vài giây)
echo "[3/5] Cài đặt thư viện Playwright Core & TSX..."
npm install --silent

# 4. Kiểm tra Python 3 & thư viện boto3 (để upload Cloudflare R2)
echo "[4/5] Kiểm tra Python 3 & thư viện boto3..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "[LỖI]: Chưa tìm thấy Python 3 trên máy Mac này!"
  exit 1
fi

if ! python3 -c "import boto3" 2>/dev/null; then
  echo "      -> Chưa có boto3, đang tự động cài đặt qua pip3..."
  pip3 install boto3 --break-system-packages --quiet 2>/dev/null || pip3 install boto3 --quiet || python3 -m pip install boto3 --break-system-packages --quiet || true
fi
if ! python3 -c "import boto3" 2>/dev/null; then
  echo "[LỖI]: Không thể cài hoặc import boto3. Hãy kiểm tra pip/Python rồi chạy setup lại."
  exit 1
fi
echo "      -> Python 3 & Boto3: OK"

# 5. Cài đặt lịch LaunchAgent và Worker Service
SCHEDULE_TIME="${1:-${CRAWLER_SCHEDULE_TIME:-12:00}}"
echo "[5/5] Cài đặt lịch tự động ($SCHEDULE_TIME) và Worker vào macOS LaunchAgent..."
bash "$SCRIPT_DIR/install_launchd.sh" "$SCHEDULE_TIME"
bash "$SCRIPT_DIR/install_worker_service.sh"

echo ""
echo "============================================================"
echo "      CHÚC MỪNG! SETUP HOÀN TẤT TRÊN MAC MINI M1!          "
echo "============================================================"
echo "1. Đảm bảo AdsPower App đang mở và Local API đang hoạt động."
echo "2. Remote Worker: ĐÃ KÍCH HOẠT (chạy ngầm nhận lệnh từ Web App)."
echo "3. Lịch tự động: Đúng $SCHEDULE_TIME mỗi ngày sẽ tự động chạy."
echo "4. Muốn chạy test ngay lập tức: ./schedule_daily_job.sh --force"
echo "5. Theo dõi log Worker trực tiếp: tail -f ~/Library/Logs/mac-crawler-worker.log"
echo "============================================================"
