# Cập nhật code Server và Mac mini

Mỗi lần có code mới: **cập nhật Server trước, sau đó cập nhật Mac mini**.

## 1. Cập nhật Server

SSH vào server:

```bash
cd /var/www/amazon-listing
git pull --ff-only
npm ci
npm run db:migrate
npm run build
pm2 restart amazon-listing --update-env
pm2 restart ppc-ingestion-worker --update-env
pm2 save
```

Nếu không đúng thư mục `/var/www/amazon-listing`, kiểm tra bằng:

```bash
pm2 describe amazon-listing
```

Kiểm tra sau cập nhật:

```bash
pm2 status
pm2 logs amazon-listing --lines 50 --nostream
pm2 logs ppc-ingestion-worker --lines 50 --nostream
```

Blank Bulk template phải nằm trên Server tại:

```text
templates/ppc/AdvertisingBulksheetTemplate-seller.xlsx
```

## 2. Đóng gói code cho Mac mini

Trên máy đang viết code:

```bash
cd "/Users/macbook/Desktop/Amazon Listing Management"
COPYFILE_DISABLE=1 tar \
  --exclude='mac-crawler/node_modules' \
  --exclude='mac-crawler/config.env' \
  --exclude='mac-crawler/downloads' \
  -czf "$HOME/Desktop/mac-crawler-release.tar.gz" mac-crawler
```

Chuyển file `mac-crawler-release.tar.gz` vào thư mục `Downloads` của Mac mini.

## 3. Cập nhật Mac mini

Dừng worker:

```bash
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.amazon.ppc.worker.plist" 2>/dev/null || true
```

Giải nén và cập nhật code:

```bash
RELEASE_DIR="$(mktemp -d)"
tar -xzf "$HOME/Downloads/mac-crawler-release.tar.gz" -C "$RELEASE_DIR"

CRAWLER_DIR=/Users/ad/AmazonPpcCrawler
rsync -a \
  --exclude='config.env' \
  --exclude='stores.json' \
  --exclude='node_modules/' \
  "$RELEASE_DIR/mac-crawler/" "$CRAWLER_DIR/"
```

Cài dependency và chạy lại worker:

```bash
cd "$CRAWLER_DIR"
npm install
bash install_worker_service.sh
```

Kiểm tra log:

```bash
tail -n 100 "$HOME/Library/Logs/mac-crawler-worker.log"
```

## 4. Cấu hình Mac mini

File `/Users/ad/AmazonPpcCrawler/config.env` cần có:

```env
WEB_APP_URL=https://domain-cua-ban.com
WEB_APP_AUTH_TOKEN=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
BULK_UPLOAD_DIR=$HOME/AmazonPpcCrawler/bulk-upload
```

Không chép blank Bulk template lên Mac mini. Mac tự tải file từ R2 vào:

```text
~/AmazonPpcCrawler/bulk-upload/inbox
```

## Checklist nhanh

1. Server: pull code → migrate → build → restart PM2.
2. Đóng gói `mac-crawler` và chuyển sang Mac mini.
3. Mac mini: dừng worker → cập nhật code → `npm install` → chạy lại worker.
4. Kiểm tra log hai máy.
5. Thử Auto Upload với một file nhỏ.
