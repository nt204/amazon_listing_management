# Hướng Dẫn Backup & Khôi Phục (Ghi Đè - Chỉ Giữ 1 Bản Mới Nhất)

*(Đã tối ưu chạy thẳng vào Container `amazon-listing-db-1`, chạy xong trong 1 giây)*

---

### 1. Tạo Bản Backup (Chạy trên Terminal VPS)
Copy nguyên khối này và dán vào VPS:

```bash
mkdir -p /root/backups
docker exec -e PGPASSWORD=listing_desk amazon-listing-db-1 pg_dump -U listing_desk listing_desk | gzip > /root/backups/db_backup.sql.gz
cp -f /var/www/amazon-listing/.env /root/backups/env_backup.env

echo "✅ Đã backup xong! Kiểm tra file:"
ls -lh /root/backups
```

---

### 2. Tải Bản Backup Về Máy Mac (Chạy trên Terminal Mac)
Mở Terminal trên máy Mac của bạn và chạy:

```bash
scp -r root@<IP_VPS>:/root/backups/ ~/Downloads/
```
*(Thay `<IP_VPS>` bằng IP VPS của bạn, file sẽ nằm ở thư mục Downloads)*

---

### 3. Khôi Phục Dữ Liệu Khi Cần (Chạy trên VPS)
Nếu gặp sự cố muốn khôi phục lại:

```bash
gunzip -c /root/backups/db_backup.sql.gz | docker exec -i -e PGPASSWORD=listing_desk amazon-listing-db-1 psql -U listing_desk -d listing_desk
cp -f /root/backups/env_backup.env /var/www/amazon-listing/.env
pm2 restart amazon-listing

echo "✅ Đã khôi phục thành công!"
```
