#!/usr/bin/env python3
"""
save_discrepancy_items.py
Lưu / Upsert kết quả đối soát lệch kho vào PostgreSQL (bảng accounting_shipment_discrepancies)
để bảo vệ dữ liệu vĩnh viễn, chống mất mát cache 100%.
"""

import sys
import json
import os
import psycopg2
from psycopg2.extras import execute_batch

def load_env(env_path):
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(script_dir, "config.env"))
    load_env(os.path.join(script_dir, "..", ".env"))

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print(json.dumps({"error": "Thiếu biến môi trường DATABASE_URL"}))
        sys.exit(1)

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"saved": 0}))
            return

        items = json.loads(raw_input)
        if not items:
            print(json.dumps({"saved": 0}))
            return

        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 30000;")

        query = """
            INSERT INTO accounting_shipment_discrepancies (
                store_name, sku, asin, shipment_id, amazon_received, 
                so_luong_amazon_nhan, discrepancy, receiving_date, status, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (store_name, shipment_id, sku) DO UPDATE SET
                asin = EXCLUDED.asin,
                amazon_received = EXCLUDED.amazon_received,
                so_luong_amazon_nhan = EXCLUDED.so_luong_amazon_nhan,
                discrepancy = EXCLUDED.discrepancy,
                receiving_date = CASE 
                    WHEN EXCLUDED.receiving_date IS NOT NULL AND EXCLUDED.receiving_date != '' THEN EXCLUDED.receiving_date
                    ELSE accounting_shipment_discrepancies.receiving_date
                END,
                status = EXCLUDED.status,
                updated_at = NOW();
        """

        records = [
            (
                it.get("store", ""),
                it.get("sku", ""),
                it.get("asin", ""),
                it.get("shipment_id", ""),
                it.get("amazon_received", 0),
                it.get("so_luong_amazon_nhan", 0),
                it.get("discrepancy", 0),
                it.get("receiving_date", ""),
                it.get("status", "")
            )
            for it in items
            if it.get("store") and it.get("sku") and it.get("shipment_id")
        ]

        execute_batch(cur, query, records, page_size=100)
        conn.commit()
        conn.close()

        print(json.dumps({"saved": len(records)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()

