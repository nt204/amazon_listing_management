#!/usr/bin/env python3
import os
import sys
import json
import glob
import hashlib
import uuid
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

def get_store_names(stores_file: Path, fallback_name: str) -> list[str]:
    if stores_file.exists():
        try:
            with open(stores_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    names = [s.get("store_name") for s in data if s.get("enabled") is not False and s.get("store_name")]
                    if names:
                        return names
        except Exception as e:
            print(f"[CẢNH BÁO] Không đọc được stores.json: {e}")
    return [fallback_name]

def main():
    load_config_env()

    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "amazon-listing-production")
    r2_prefix = os.environ.get("PPC_R2_PREFIX", "ppc-reports").strip("/")
    default_store = os.environ.get("STORE_NAME", "HSOSTORE")

    safe_base_dir = Path.home() / "Library" / "Application Support" / "AmazonPpcCrawler" / "downloads"
    base_dir_raw = os.environ.get("DOWNLOAD_BASE_DIR", str(safe_base_dir))
    base_dir = Path(os.path.expandvars(os.path.expanduser(base_dir_raw))).resolve()
    protected_dirs = [Path.home() / "Downloads", Path.home() / "Desktop"]
    if any(base_dir == protected or protected in base_dir.parents for protected in protected_dirs):
        print(f"[CONFIG] DOWNLOAD_BASE_DIR bị macOS bảo vệ; dùng {safe_base_dir}")
        base_dir = safe_base_dir

    if not all([account_id, access_key, secret_key, bucket_name]):
        print("[LỖI] Thiếu thông tin cấu hình Cloudflare R2 trong config.env!", file=sys.stderr)
        sys.exit(1)

    today_str = datetime.now().strftime("%Y-%m-%d")
    batch_date = datetime.now().strftime("%Y%m%d")
    today_dir = base_dir / today_str

    stores_file = Path(__file__).resolve().parent / "stores.json"
    configured_stores = get_store_names(stores_file, default_store)

    # Tìm tất cả các store folder thực tế có trong today_dir
    target_stores = set(configured_stores)
    if today_dir.exists():
        for p in today_dir.iterdir():
            if p.is_dir() and not p.name.startswith("."):
                target_stores.add(p.name)

    # Thu thập danh sách file của từng store
    # item: (file_path, store_name, sub_dir)
    files_to_upload: list[tuple[Path, str, str]] = []

    for sname in sorted(target_stores):
        store_dir = today_dir / sname
        if not store_dir.exists():
            continue

        manifest_file = store_dir / "manifest.json"
        store_files: list[tuple[Path, str, str]] = []

        if manifest_file.exists():
            try:
                with open(manifest_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for item in data.get("files", []):
                        fpath = Path(item["path"])
                        if fpath.exists():
                            sub = item.get("relativeSubdir", "SP")
                            store_files.append((fpath, sname, sub))
            except Exception as e:
                print(f"[CẢNH BÁO] Không đọc được manifest của [{sname}]: {e}")

        if not store_files:
            # Quét thủ công SP và SB
            for sub in ["SP", "SB"]:
                sub_dir = store_dir / sub
                if sub_dir.exists():
                    for ext in ["*.xlsx", "*.csv"]:
                        for fpath in sub_dir.glob(ext):
                            store_files.append((fpath, sname, sub))

        files_to_upload.extend(store_files)

    if not files_to_upload:
        print(f"[CẢNH BÁO] Không tìm thấy file báo cáo nào để upload tại: {today_dir}")
        sys.exit(0)

    print("============================================================")
    print(f"[R2 MULTI-STORE UPLOAD] BẮT ĐẦU UPLOAD {len(files_to_upload)} FILE LÊN CLOUDFLARE R2")
    print(f"Bucket: {bucket_name} | Batch: {batch_date}")
    print(f"Danh sách Store phát hiện: {', '.join(sorted(target_stores))}")
    print("============================================================")

    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    s3_client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
        region_name="auto",
    )

    success_count = 0
    store_summary: dict[str, int] = {}
    uploaded_keys: dict[str, list[str]] = {}
    uploaded_integrity: dict[str, list[dict]] = {}
    batch_ids = {sname: f"{sname}_{batch_date}_manual_{uuid.uuid4().hex[:8]}" for sname in target_stores}

    for idx, (fpath, sname, sub_dir) in enumerate(files_to_upload, start=1):
        file_name = fpath.name
        file_size_mb = fpath.stat().st_size / (1024 * 1024)

        # R2 Key: ppc-reports/input/{batch_date}/{store_name}/{sub_dir}/{file_name}
        r2_key = f"{r2_prefix}/input/{batch_date}/{sname}/{batch_ids[sname]}/{sub_dir}/{file_name}"

        print(f"\n[{idx}/{len(files_to_upload)}] [Store: {sname}] Upload: {file_name} ({file_size_mb:.2f} MB)...")
        print(f"       -> R2 Key: {r2_key}")

        try:
            s3_client.upload_file(
                Filename=str(fpath),
                Bucket=bucket_name,
                Key=r2_key,
                ExtraArgs={
                    "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    if fpath.suffix == ".xlsx"
                    else "text/csv"
                },
            )
            print(f"       => [OK] Đã tải lên thành công!")
            success_count += 1
            store_summary[sname] = store_summary.get(sname, 0) + 1
            uploaded_keys.setdefault(sname, []).append(r2_key)
            digest = hashlib.sha256()
            with open(fpath, "rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            uploaded_integrity.setdefault(sname, []).append({
                "key": r2_key,
                "sha256": digest.hexdigest(),
                "sizeBytes": fpath.stat().st_size,
            })
        except Exception as e:
            print(f"       => [THẤT BẠI] Lỗi upload file {file_name}: {e}", file=sys.stderr)

    # Publish marker last. Server ignores every batch without this marker.
    for sname, keys in uploaded_keys.items():
        expected_slots = {
            "Bulk_SP_30Days", "Bulk_SB_30Days", "Bulk_SP_7Days",
            "Bulk_SB_7Days", "Search_Term_SP_30Days", "Search_Term_SB_30Days",
        }
        actual_slots = {
            slot for slot in expected_slots if any(slot.lower() in key.lower() for key in keys)
        }
        if len(keys) != 6 or actual_slots != expected_slots:
            print(f"[LỖI] [{sname}] chưa đúng đủ 6 slot; không publish _COMPLETE.json.", file=sys.stderr)
            continue
        marker_key = f"{r2_prefix}/input/{batch_date}/{sname}/{batch_ids[sname]}/_COMPLETE.json"
        marker = json.dumps({
            "version": 2,
            "batchId": batch_ids[sname],
            "storeName": sname,
            "batchDate": batch_date,
            "completedAt": datetime.now().isoformat(),
            "files": keys,
            "checksums": uploaded_integrity.get(sname, []),
        }).encode("utf-8")
        s3_client.put_object(Bucket=bucket_name, Key=marker_key, Body=marker, ContentType="application/json")
        print(f"[OK] [{sname}] Đã publish batch marker: {marker_key}")

    print("\n============================================================")
    print(f"[R2 UPLOAD] TỔNG KẾT: {success_count}/{len(files_to_upload)} file đã được lưu trên Cloudflare R2.")
    for sname, count in store_summary.items():
        print(f"  - [{sname}]: {count} file thành công")
    print("============================================================")

    if success_count < len(files_to_upload):
        sys.exit(1)

if __name__ == "__main__":
    main()
