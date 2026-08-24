# Hướng Dẫn Deploy Máy Chủ VPS (Ubuntu 22.04 LTS)

## 📋 1. Chuẩn Bị Server (Khuyên Dùng)
- **Cấu hình**: 4 vCPU | 6-8 GB RAM | 50 GB NVMe SSD
- **Hệ điều hành**: Ubuntu 22.04 LTS
- **Kết nối SSH**: `ssh root@<IP_VPS>`

---

## ⚡ 2. Cài Đặt Môi Trường (Copy & Paste Lần Lượt)

```bash
# 1. Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx

# 2. Cài Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Cài PostgreSQL & Redis
sudo apt install -y postgresql postgresql-contrib redis-server
sudo systemctl enable postgresql redis-server
sudo systemctl start postgresql redis-server

# 4. Tạo Database & User PostgreSQL
sudo -u postgres psql -c "CREATE DATABASE amazon_listing;"
sudo -u postgres psql -c "CREATE USER listing_user WITH PASSWORD 'MatKhauBaoMat123!';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE amazon_listing TO listing_user;"
```

---

## 🛠️ 3. Tải Code & Cấu Hình `.env`

```bash
# 1. Clone code vào thư mục server
git clone <URL_GIT_REPO> /var/www/amazon-listing
cd /var/www/amazon-listing

# 2. Cài đặt thư viện
npm install

# 3. Tạo file .env
nano .env
```

**Nội dung `.env` mẫu**:
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://listing_user:MatKhauBaoMat123!@localhost:5432/amazon_listing
REDIS_URL=redis://localhost:6379

TRELLO_API_KEY=your_trello_api_key
TRELLO_TOKEN=your_trello_token
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Bật bảo mật đăng nhập phân quyền cho Team (Tùy chọn khuyến nghị)
LISTING_DESK_AUTH_MODE=required
LISTING_DESK_DEFAULT_TEAM_ID=pod-team-1
LISTING_DESK_SESSION_SECRET=thay-bang-chuoi-ngau-nhien-toi-thieu-32-ky-tu
LISTING_DESK_TEAMS_JSON=[{"team_id":"pod-team-1","user_id":"admin-user","role":"admin","token":"MatKhauBaoMatTeamCapRongTren24KyTu123!"}]
```

```bash
# 4. Khởi tạo các bảng Database
npm run db:migrate
npm run auth:bootstrap
```

---

## 🚀 4. Build & Chạy Ứng Dụng Với PM2

```bash
# 1. Biên dịch dự án Next.js
npm run build

# 2. Chạy ngầm bằng PM2
sudo npm install -g pm2
pm2 start npm --name "amazon-listing" -- start
pm2 save
pm2 startup
```

---

## 🌐 5. Cấu Hình Nginx (Chạy Trực Tiếp Qua IP)

```bash
sudo nano /etc/nginx/sites-available/amazon-listing
```

Dán nội dung cấu hình Nginx:
```nginx
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# Kích hoạt Nginx
sudo ln -s /etc/nginx/sites-available/amazon-listing /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🛡️ 6. Tạo Bộ Nhớ RAM Ảo (Swap) — *Tránh Tràn RAM*

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 📌 Các Lệnh Bảo Trì Thường Dùng

```bash
pm2 restart amazon-listing    # Restart lại web app
pm2 logs amazon-listing       # Xem log ứng dụng trực tiếp
pm2 status                    # Xem trạng thái chạy ngầm
```
