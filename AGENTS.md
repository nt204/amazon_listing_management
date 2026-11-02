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
- Đổi `mac-crawler/*` hoặc `scripts/ingest_monthly_from_raw.py` thì phải chép sang Mac mini (`ad@100.111.217.54:/Users/ad/mac-crawler`) — crawler hằng tháng chạy bản ở đó.
