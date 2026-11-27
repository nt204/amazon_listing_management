# Cấu hình trang xưởng `fulfill.ncehub.net`

Xưởng đăng nhập bằng email + mã OTP của Cloudflare, rồi xem yêu cầu đi hàng ở `https://fulfill.ncehub.net/sup` (chỉ đọc).

- **Cloudflare** chỉ xác nhận người đăng nhập đúng là chủ email đó (cho mọi email).
- **Web (tab Suppliers trong Đi hàng)** quyết định email nào được xem lô của Sup nào. Email chưa có tài khoản thấy "No access".
- **nginx** trên tên miền này chỉ mở `/sup`, `/api/sup/`, `/_next/static/` (chỉ GET) và webhook Trello. Phần nội bộ không truy cập được từ đây.
- Tên miền nội bộ `ncehub.net` giữ nguyên policy cũ, **không** thêm email xưởng. Nhân viên mở Đi hàng ở `https://ncehub.net/fulfill`.

> `fulfill.ncehub.net/api/trello/webhook` là địa chỉ webhook Trello (thẻ R&D → Bảng Mã) đã đăng ký. Bước 2b và cấu hình nginx giữ cho webhook chạy tiếp. Làm xong thì kéo thử 1 thẻ Trello sang cột ĐI HÀNG FBA để kiểm tra.

## 0. Kiểm tra trước khi đổi

```bash
ssh root@167.233.26.87
grep -rn "fulfill.ncehub.net" /etc/nginx/sites-enabled/
```

- Không ra gì: `fulfill.ncehub.net` đang rơi vào site mặc định. Làm tiếp bước 3.
- Ra dòng `server_name ... fulfill.ncehub.net ...` trong site khác: bỏ `fulfill.ncehub.net` khỏi dòng đó (giữ các tên khác), vì site mới ở bước 3 sẽ phục vụ tên miền này.

Trên Cloudflare **Zero Trust → Access → Applications**: xem đã có application nào cho `fulfill.ncehub.net` chưa. Có thì sửa application đó theo bước 2, không tạo trùng.

## 1. DNS

Bản ghi `fulfill` đã có. Kiểm tra: **Type A**, Content `167.233.26.87`, **Proxied** (mây cam). Khác thì **Edit** cho đúng.

## 2. Cloudflare Access

**Zero Trust** → **Settings** → **Authentication**: kiểm tra đã bật **One-time PIN**.

### 2a. Trang xưởng

**Access** → **Applications** → **Add an application** → **Self-hosted**

- Application name: `NCE Supplier`
- Session duration: `24 hours`
- Application domain: `fulfill.ncehub.net` (path để trống)
- Identity providers: chỉ **One-time PIN**; bật **Instant Auth**
- Policy: name `Supplier OTP`, Action **Allow**, Include **Everyone**

### 2b. Webhook Trello (Trello không đăng nhập được)

**Add an application** → **Self-hosted**

- Application name: `Trello webhook`
- Application domain: `fulfill.ncehub.net`, path `api/trello/webhook`
- Policy: name `Trello bypass`, Action **Bypass**, Include **Everyone**

Application có path cụ thể được ưu tiên hơn 2a, nên chỉ đúng đường dẫn webhook không phải đăng nhập.

## 3. nginx trên máy chủ

```bash
# Đường dẫn chứng chỉ đang dùng cho ncehub.net
grep -n "ssl_certificate" /etc/nginx/sites-enabled/ncehub.net
```

Chép `deploy/nginx/fulfill.ncehub.net.conf` lên `/etc/nginx/sites-available/fulfill.ncehub.net`, sửa 2 dòng `ssl_certificate` / `ssl_certificate_key` theo kết quả trên.

Chứng chỉ phải phủ `fulfill.ncehub.net`:

- Cloudflare Origin Certificate cho `*.ncehub.net` thì dùng lại được.
- Chứng chỉ chỉ cho `ncehub.net` thì tạo thêm Origin Certificate cho `fulfill.ncehub.net` (SSL/TLS → Origin Server), hoặc chạy certbot.

```bash
ln -s /etc/nginx/sites-available/fulfill.ncehub.net /etc/nginx/sites-enabled/fulfill.ncehub.net
nginx -t && systemctl reload nginx
```

`nginx -t` báo lỗi, hoặc cảnh báo `conflicting server name "fulfill.ncehub.net"`: không reload, quay lại bước 0.

## 4. Deploy code

```bash
bash scripts/deploy-server.sh
```

Script chạy migration `175_fulfill_sup_accounts.sql` (bảng tài khoản xưởng, view và role chỉ đọc `fulfill_sup_reader`). User Postgres của app cần quyền tạo role; user mặc định của container Postgres có quyền này.

## 5. Tạo tài khoản và thử

1. `https://ncehub.net/fulfill` → tab **Suppliers** → **Add account**: email xưởng, tên, chọn Sup.
2. Trình duyệt ẩn danh → `https://fulfill.ncehub.net` → nhập email xưởng → nhập mã OTP → thấy danh sách lô của xưởng.
3. Kiểm tra phần nội bộ bị chặn, mỗi đường dẫn phải ra 404:
   - `https://fulfill.ncehub.net/fulfill`
   - `https://fulfill.ncehub.net/api/fulfill/lots`
   - `https://fulfill.ncehub.net/api/accounting/stores`
4. Đăng nhập bằng một email chưa có tài khoản → phải thấy "No access".
5. Kiểm tra `ncehub.net` với email xưởng: Cloudflare phải chặn ngay ở màn đăng nhập.
6. Webhook: `curl -I https://fulfill.ncehub.net/api/trello/webhook` phải trả `200`. Kéo thử 1 thẻ Trello sang cột ĐI HÀNG FBA → SKU vào Bảng Mã.

## Ngừng cấp quyền

Tab **Suppliers** → **Disable** hoặc **Delete**. Có hiệu lực ngay ở request tiếp theo; không cần làm gì trên Cloudflare.
