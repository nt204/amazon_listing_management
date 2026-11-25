#!/usr/bin/env bash
# Chỉ cho truy cập app qua Cloudflare. Chạy từ máy local: bash scripts/server/cloudflare-only.sh
#
# Vì sao: app đăng nhập bằng header `cf-access-authenticated-user-email` do Cloudflare Access gắn vào.
# Trước đây ai biết IP VPS đều gọi thẳng được nginx :443 hoặc next-server :2411 rồi tự gắn header đó → vào app
# với email bất kỳ mà không qua đăng nhập. Sau khi chạy:
#   - nginx (server ncehub.net :443) chỉ nhận IP Cloudflare + localhost (snippet /etc/nginx/snippets/cloudflare-only.conf,
#     lấy từ https://www.cloudflare.com/ips/ mỗi lần chạy lại script).
#   - Cổng 2411 (next-server) bị chặn từ ngoài; nginx, deploy script, worker vẫn dùng localhost:2411.
#   - Luật tường lửa nằm trong dịch vụ systemd app-port-guard → khởi động lại server vẫn giữ.
# Hoàn tác: xoá dòng `include snippets/cloudflare-only.conf;` trong site nginx + `systemctl disable --now app-port-guard`
# rồi `iptables -D INPUT -i eth0 -j APP-GUARD; ip6tables -D INPUT -i eth0 -j APP-GUARD`.
set -euo pipefail
SERVER="${SERVER:-root@167.233.26.87}"

ssh "$SERVER" 'bash -s' <<'REMOTE'
set -euo pipefail
SITE=/etc/nginx/sites-enabled/ncehub.net
SNIP=/etc/nginx/snippets/cloudflare-only.conf

# 1. Danh sách IP Cloudflare
v4=$(curl -sf --max-time 15 https://www.cloudflare.com/ips-v4)
v6=$(curl -sf --max-time 15 https://www.cloudflare.com/ips-v6)
[ -n "$v4" ] && [ -n "$v6" ] || { echo "Không lấy được danh sách IP Cloudflare — dừng, không đổi gì"; exit 1; }
tmp=$(mktemp)
{
  echo "# Chỉ nhận kết nối từ Cloudflare (+ localhost). Sinh bởi scripts/server/cloudflare-only.sh — $(date +%F)"
  printf '%s\n%s\n' "$v4" "$v6" | grep -v '^$' | sed 's/^/allow /; s/$/;/'
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  echo "deny all;"
} > "$tmp"
[ -f "$SNIP" ] && cp "$SNIP" "$SNIP.bak"
install -m 644 "$tmp" "$SNIP"; rm -f "$tmp"

# 2. Gắn snippet vào server block 443 (một lần)
if ! grep -q 'snippets/cloudflare-only.conf' "$SITE"; then
  cp "$SITE" "/root/nginx-ncehub.net.bak-$(date +%Y%m%d%H%M%S)"
  # server block đầu tiên là block 443 (block cuối là redirect :80)
  sed -i '0,/server_name ncehub.net;/s//server_name ncehub.net;\n    include snippets\/cloudflare-only.conf;/' "$SITE"
fi
if nginx -t 2>&1 | grep -q 'test is successful'; then
  systemctl reload nginx
  echo "nginx: đã reload"
else
  nginx -t || true
  echo "nginx -t LỖI — khôi phục bản cũ"
  [ -f "$SNIP.bak" ] && cp "$SNIP.bak" "$SNIP"
  sed -i '/snippets\/cloudflare-only.conf/d' "$SITE"
  exit 1
fi

# 3. Chặn cổng 2411 từ ngoài
cat > /usr/local/sbin/app-port-guard.sh <<'EOF'
#!/bin/sh
# next-server chạy trực tiếp trên host (không qua docker) nên lọc ở INPUT.
IF=eth0
for t in iptables ip6tables; do
  $t -N APP-GUARD 2>/dev/null || true
  $t -F APP-GUARD
  $t -A APP-GUARD -p tcp --dport 2411 -j DROP
  $t -C INPUT -i $IF -j APP-GUARD 2>/dev/null || $t -I INPUT 1 -i $IF -j APP-GUARD
done
EOF
chmod +x /usr/local/sbin/app-port-guard.sh
cat > /etc/systemd/system/app-port-guard.service <<'EOF'
[Unit]
Description=Block public access to Next.js app port 2411 (only via nginx/Cloudflare)
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/app-port-guard.sh

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable app-port-guard >/dev/null 2>&1
systemctl restart app-port-guard
echo "app-port-guard: $(systemctl is-active app-port-guard)"
curl -s -o /dev/null -w "App localhost:2411 HTTP %{http_code}\n" http://localhost:2411/ || true
curl -sk -o /dev/null -w "nginx localhost:443 HTTP %{http_code}\n" --resolve ncehub.net:443:127.0.0.1 https://ncehub.net/ || true
REMOTE

echo "--- Kiểm tra từ máy này:"
nc -z -w 5 167.233.26.87 2411 && echo "❌ 2411 vẫn mở" || echo "✅ 2411 đã chặn"
code=$(curl -sk -o /dev/null -m 10 -w '%{http_code}' --resolve ncehub.net:443:167.233.26.87 https://ncehub.net/ || true)
[ "$code" = "403" ] && echo "✅ Gọi thẳng IP VPS :443 bị từ chối (403)" || echo "❌ Gọi thẳng IP VPS :443 trả $code"
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://ncehub.net/ || true)
echo "Qua Cloudflare: HTTP $code (302 = chuyển sang đăng nhập Cloudflare Access là đúng)"
