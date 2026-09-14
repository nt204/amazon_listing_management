#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Upload 6 real Amazon Bulk files from Downloads to Cloudflare R2
"""

import os
import sys
import time
import boto3
from botocore.config import Config

SOURCE_DIR = "/Users/macbook/Downloads/Bulk file "
STORE_NAME = "Warmstorey"
DATE_STR = "20260914"

# Cloudflare R2 Configuration
R2_ACCOUNT_ID = "131dc461c96e378361b5f78dad32311a"
R2_BUCKET = "amazon-listing-production"
R2_ACCESS_KEY = "52739112f33077ed180d916efcfe322d"
R2_SECRET_KEY = "815b91b15dc6b32a89173b6cfd900f70d798eec46e22cd2f2d89f69f3de79bd5"
R2_PREFIX = "ppc-reports"

FILE_MAPPING = {
    "bulk-a1qiqhomjzfqb8-20260813-20260913-1789340669395.xlsx": f"{STORE_NAME} Bulk File SP {DATE_STR} (30 day).xlsx",
    "bulk-a1qiqhomjzfqb8-20260813-20260913-1789340815760.xlsx": f"{STORE_NAME} Bulk File SB {DATE_STR} (30 day).xlsx",
    "bulk-a1qiqhomjzfqb8-20260829-20260913-1789340662741.xlsx": f"{STORE_NAME} Bulk File SP {DATE_STR} (14 day).xlsx",
    "bulk-a1qiqhomjzfqb8-20260829-20260913-1789340812813.xlsx": f"{STORE_NAME} Bulk File SB {DATE_STR} (14 day).xlsx",
    "bulk-a1qiqhomjzfqb8-20260905-20260913-1789340659305.xlsx": f"{STORE_NAME} Bulk File SP {DATE_STR} (7 day).xlsx",
    "bulk-a1qiqhomjzfqb8-20260905-20260913-1789340802220.xlsx": f"{STORE_NAME} Bulk File SB {DATE_STR} (7 day).xlsx",
}

def upload_all():
    print("[1/3] Đang khởi tạo kết nối Cloudflare R2...")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 5})
    )

    print(f"[2/3] Bắt đầu upload 6 file từ '{SOURCE_DIR}' lên R2 bucket '{R2_BUCKET}'...")
    uploaded = 0
    start_total = time.time()

    for orig_name, target_name in FILE_MAPPING.items():
        src_path = os.path.join(SOURCE_DIR, orig_name)
        if not os.path.exists(src_path):
            print(f"  [X] Không tìm thấy file nguồn: {orig_name}")
            continue

        size_mb = os.path.getsize(src_path) / (1024 * 1024)
        r2_key = f"{R2_PREFIX}/input/{DATE_STR}/{STORE_NAME}/{target_name}"

        print(f"  -> Uploading {target_name} ({size_mb:.1f} MB) -> r2://{R2_BUCKET}/{r2_key}...")
        t0 = time.time()
        
        s3.upload_file(
            Filename=src_path,
            Bucket=R2_BUCKET,
            Key=r2_key,
            ExtraArgs={"ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        )
        duration = time.time() - t0
        speed = size_mb / duration if duration > 0 else 0
        print(f"     [OK] Đã upload trong {duration:.1f}s (~{speed:.1f} MB/s)")
        uploaded += 1

    total_time = time.time() - start_total
    print(f"\n[3/3] HOÀN THÀNH: Đã upload {uploaded}/6 file lên Cloudflare R2 trong {total_time:.1f} giây.")

if __name__ == "__main__":
    upload_all()
