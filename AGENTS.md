<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deploy lên server production — BẮT BUỘC

Mọi agent/người deploy lên VPS (`167.233.26.87`, `/var/www/amazon-listing`) **chỉ dùng** `bash scripts/deploy-server.sh`
(hướng dẫn: `.claude/skills/deploy/SKILL.md`). Không tự ghép `git pull && npm ci && npm run build && pm2 reload` qua SSH/paramiko.

- **Mỗi lúc chỉ một người deploy.** Script giữ khoá trên server; bị báo "Đang có người khác deploy" thì đợi, không chạy song song.
- **Chỉ reload app khi build thành công.** Build lỗi thì dừng, app cũ vẫn chạy.
- Ngày 2026-11-02 app sập 2–3 phút vì hai agent deploy cùng lúc (`npm ci` chạy đúng lúc build, rồi reload trên bản build hỏng).
- Đổi `scripts/ingest_monthly_from_raw.py` thì chạy thêm `bash scripts/sync-mac-mini.sh` (Mac mini `ad@100.111.217.54:/Users/ad/mac-crawler` chạy crawler + ingest hằng tháng bằng bản chép riêng). Đổi `mac-crawler/*` cũng phải chép sang đó.

# Truy vấn trên DB production — BẮT BUỘC

- `DATABASE_URL` trong `.env` (`localhost:2412`) là **Postgres Docker trên máy Mac, KHÔNG phải production**. Phân tích, đo thử,
  thử truy vấn: làm trên DB local này.
- DB production (container `amazon-listing-db-1` trên VPS, bảng `ppc_performance_facts` ~22 GB) **không chạy truy vấn nặng
  trong giờ làm việc (7h–22h giờ VN)**: không `count(*)`/quét toàn bộ facts, không `create temp table … as select` trên facts,
  không VACUUM tay. Ngày 2026-11-17 các truy vấn kiểu này chạy 3–46 phút lúc 8h44–10h33 làm cả web PPC lag.
- Cần số liệu production trong giờ làm việc thì chỉ đọc nhẹ (có `WHERE store_id = … AND snapshot_date = …`, có `LIMIT`),
  đặt `SET statement_timeout = '30s'` trước, và xem `pg_stat_statements` thay vì tự quét bảng.
- Dọn facts nặng (xoá dòng rác, thu gọn snapshot cũ, VACUUM) chỉ chạy ban đêm: `ppc-ingestion-worker` (3h–5h VN) và cron
  `/root/scripts/ppc_daily_cleanup.sh` (2h VN). Không thêm lại bước này vào sau mỗi lần ingest.
