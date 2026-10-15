#!/usr/bin/env python3
import os
import sys
import json
import glob
from datetime import datetime
from pathlib import Path
import boto3
from botocore.config import Config

def load_config_env():
    env_file = Path(__file__).resolve().parent / "config.env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key not in os.environ:
                    val = os.path.expandvars(os.path.expanduser(val))
                    os.environ[key] = val

def main():
    load_config_env()

    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "amazon-listing-production")
    r2_prefix = os.environ.get("ACCOUNTING_R2_PREFIX", "accounting-reports").strip("/")

    safe_base_dir = Path.home() / "AmazonAccounting" / "downloads"
    base_dir_raw = os.environ.get("ACCOUNTING_DOWNLOAD_DIR", str(safe_base_dir))
    base_dir = Path(os.path.expandvars(os.path.expanduser(base_dir_raw))).resolve()

    if not all([account_id, access_key, secret_key, bucket_name]):
        print("[LỖI] Thiếu thông tin cấu hình Cloudflare R2 trong config.env!", file=sys.stderr)
        sys.exit(1)

    s3_client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"})
    )

    if not base_dir.exists():
        print(f"[CẢNH BÁO] Thư mục tải về không tồn tại: {base_dir}")
        sys.exit(0)

    # Quét tất cả các ngày và store
    uploaded_count = 0
    date_dirs = [d for d in base_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]

    for date_dir in sorted(date_dirs):
        date_str = date_dir.name
        store_dirs = [s for s in date_dir.iterdir() if s.is_dir() and not s.name.startswith(".")]
        for store_dir in sorted(store_dirs):
            store_name = store_dir.name
            files = [f for f in store_dir.iterdir() if f.is_file() and not f.name.startswith(".") and f.name != "manifest.json"]
            for fpath in sorted(files):
                fname = fpath.name
                r2_key = f"{r2_prefix}/{date_str}/{store_name}/{fname}"
                size_mb = fpath.stat().st_size / (1024 * 1024)
                print(f"[R2 UPLOAD] Đang đẩy lên R2: {r2_key} ({size_mb:.2f} MB)...")
                try:
                    s3_client.upload_file(str(fpath), bucket_name, r2_key)
                    uploaded_count += 1
                except Exception as err:
                    print(f"[LỖI R2] Không upload được {fname}: {err}", file=sys.stderr)

    print(f"\n[HOÀN TẤT] Đã upload {uploaded_count} file kế toán lên Cloudflare R2 ({bucket_name}/{r2_prefix}/) thành công!")

if __name__ == "__main__":
    main()
