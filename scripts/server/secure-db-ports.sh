#!/usr/bin/env bash
# Chặn Postgres (2412) / Redis (2413) của VPS khỏi internet. Chạy từ máy local: bash scripts/server/secure-db-ports.sh
#
# Trước đây 2 cổng này mở cho mọi IP (ufw tắt, docker publish 0.0.0.0 và [::]) — Postgres dùng mật khẩu mặc định,
# Redis không mật khẩu. Sau khi chạy:
#   - Redis 2413: chỉ trong server (app, worker vẫn dùng localhost).
#   - Postgres 2412: chỉ trong server + các IP trong ALLOW_DB (Mac mini crawler nạp số tháng qua cổng này).
#   - Luật nằm trong dịch vụ systemd db-port-guard → khởi động lại server / docker vẫn giữ.
# Đổi IP được phép: sửa /etc/default/db-port-guard trên server rồi `systemctl restart db-port-guard`.
set -euo pipefail
SERVER="${SERVER:-root@167.233.26.87}"
ALLOW_DB="${ALLOW_DB:-113.190.144.23 115.72.61.254}" # máy văn phòng, Mac mini crawler (IP public 2026-11-10)

ssh "$SERVER" "ALLOW_DB='$ALLOW_DB' bash -s" <<'REMOTE'
set -euo pipefail
cat > /usr/local/sbin/db-port-guard.sh <<'EOF'
#!/bin/sh
# Docker publish cổng qua DNAT nên IPv4 lọc ở chain DOCKER-USER; IPv6 đi qua docker-proxy nên lọc ở INPUT.
ALLOW_DB=""
[ -f /etc/default/db-port-guard ] && . /etc/default/db-port-guard
IF=eth0
iptables -N DB-GUARD 2>/dev/null || true
iptables -F DB-GUARD
for ip in $ALLOW_DB; do
  iptables -A DB-GUARD -p tcp -s "$ip" -m conntrack --ctorigdstport 2412 --ctdir ORIGINAL -j RETURN
done
iptables -A DB-GUARD -p tcp -m conntrack --ctorigdstport 2412 --ctdir ORIGINAL -j DROP
iptables -A DB-GUARD -p tcp -m conntrack --ctorigdstport 2413 --ctdir ORIGINAL -j DROP
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -i $IF -j DB-GUARD 2>/dev/null || iptables -I DOCKER-USER 1 -i $IF -j DB-GUARD
ip6tables -N DB-GUARD 2>/dev/null || true
ip6tables -F DB-GUARD
ip6tables -A DB-GUARD -p tcp -m multiport --dports 2412,2413 -j DROP
ip6tables -C INPUT -i $IF -j DB-GUARD 2>/dev/null || ip6tables -I INPUT 1 -i $IF -j DB-GUARD
EOF
chmod +x /usr/local/sbin/db-port-guard.sh

cat > /etc/default/db-port-guard <<EOF
# IP được vào Postgres 2412 từ ngoài (cách nhau dấu cách)
ALLOW_DB="$ALLOW_DB"
EOF

cat > /etc/systemd/system/db-port-guard.service <<'EOF'
[Unit]
Description=Block public access to Postgres/Redis docker ports
After=docker.service network-online.target
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/db-port-guard.sh

[Install]
WantedBy=multi-user.target docker.service
EOF
systemctl daemon-reload
systemctl enable db-port-guard >/dev/null 2>&1
systemctl restart db-port-guard
echo "db-port-guard: $(systemctl is-active db-port-guard)"
iptables -S DB-GUARD
ip6tables -S DB-GUARD
REMOTE

echo "--- Kiểm tra từ máy này ($(curl -s -4 --max-time 8 https://ifconfig.me || echo '?')):"
nc -z -w 5 167.233.26.87 2413 && echo "❌ Redis 2413 vẫn mở" || echo "✅ Redis 2413 đã chặn"
nc -z -w 5 167.233.26.87 2412 && echo "Postgres 2412 mở cho máy này (đúng nếu IP nằm trong ALLOW_DB)" || echo "Postgres 2412 đã chặn với máy này"
ssh "$SERVER" 'curl -s -o /dev/null -w "App HTTP %{http_code}\n" http://localhost:2411/ || true'
