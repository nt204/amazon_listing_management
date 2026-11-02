#!/usr/bin/env bash
# Deploy lên VPS production an toàn:
#  - Khoá trên server (flock): mỗi lúc chỉ MỘT người/agent deploy. Người thứ hai bị từ chối ngay, không chạy chồng.
#  - Build lỗi thì DỪNG, KHÔNG reload app (app cũ vẫn chạy). Chỉ reload khi build thành công.
#  - npm ci chỉ chạy khi package-lock.json đổi (npm ci xoá node_modules — chạy song song với build sẽ làm build lỗi).
#  - Restart cả các worker chạy bằng tsx (chúng chỉ đọc code lúc khởi động).
#
# Dùng: bash scripts/deploy-server.sh            (deploy origin/main)
#       DEPLOY_SERVER=root@host bash scripts/deploy-server.sh
# Code phải được commit + push lên origin/main trước khi chạy.
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@167.233.26.87}"

ssh -o StrictHostKeyChecking=accept-new "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
APP_DIR=/var/www/amazon-listing
LOCK=/tmp/amazon-listing-deploy.lock
BUILD_LOG=/tmp/amazon-listing-build.log
WORKERS="accounting-import-worker lark-agent-worker ppc-ingestion-worker ppc-outcome-worker"

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "❌ Đang có người khác deploy (khoá $LOCK). Đợi họ xong rồi chạy lại — KHÔNG chạy build/npm ci tay song song."
  exit 1
fi
echo "$(date '+%F %T') $(whoami)@$(hostname)" > "$LOCK.owner"

cd "$APP_DIR"
git checkout -- next-env.d.ts 2>/dev/null || true
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "❌ Thư mục app trên server có file sửa tay chưa commit:"; git status --short --untracked-files=no
  exit 1
fi

before=$(git rev-parse HEAD)
git pull --ff-only origin main
after=$(git rev-parse HEAD)
echo "📦 $(git log --oneline -1)"

if ! git diff --quiet "$before" "$after" -- package-lock.json; then
  echo "📥 package-lock.json đổi → npm ci"
  npm ci
fi

npm run db:migrate

echo "🔨 Đang build (log: $BUILD_LOG)..."
if ! npm run build > "$BUILD_LOG" 2>&1; then
  tail -40 "$BUILD_LOG"
  echo "❌ Build LỖI — KHÔNG reload. App đang chạy giữ nguyên. Sửa lỗi rồi deploy lại."
  exit 1
fi

pm2 reload amazon-listing --update-env
pm2 restart $WORKERS --update-env > /dev/null
sleep 8
code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:2411/ || true)
pm2 ls | grep -E "amazon-listing|worker" || true
if [ "$code" != "200" ]; then
  echo "⚠️ App trả HTTP $code sau khi reload — kiểm tra: pm2 logs amazon-listing --lines 50"
  exit 1
fi
echo "✅ Deploy xong $(git log --oneline -1) — app HTTP 200"
REMOTE
