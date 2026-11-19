#!/usr/bin/env python3
"""
get_discrepancy_shipments.py
Truy vấn danh sách shipment có discrepancy lệch từ bảng accounting_inbound_shipments.
Quy tắc:
- Chỉ lấy các lô hàng ĐÃ ĐẾN KHO hoặc ĐANG NHẬN (status IN ('Closed', 'Receiving', 'Delivered')).
  BỎ QUA các lô 'In transit', 'Working', 'Shipped' (hàng đang đi trên đường, chưa nhận kiện nào nên không phải lệch thực sự).
- Lô nào chỉ có 1 SKU -> Mặc định con đó lệch luôn, lấy trực tiếp từ DB kèm ASIN từ bảng mã.
- Lô nào có > 1 SKU -> Cần mở Seller Central để check xem chính xác SKU/ASIN nào bị lệch bao nhiêu.
"""

import sys
import json
import os
import psycopg2

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

    store_name = sys.argv[1] if len(sys.argv) > 1 else "FASTPEACE"

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("SET statement_timeout = 30000;")
        
        # Chỉ quét các lô ĐÃ ĐẾN KHO / ĐANG NHẬN (loại trừ In transit, Working, Shipped)
        query = """
            WITH disc_shipments AS (
                SELECT DISTINCT s.shipment_id
                FROM accounting_inbound_shipments s
                JOIN stores st ON s.store_id = st.id
                WHERE UPPER(st.name) = UPPER(%s)
                  AND s.shipment_id IS NOT NULL 
                  AND TRIM(s.shipment_id) != ''
                  AND s.discrepancy IS NOT NULL 
                  AND s.discrepancy != 0
                  AND s.deleted_at IS NULL
                  AND LOWER(TRIM(COALESCE(s.status, ''))) NOT IN ('in transit', 'working', 'shipped', 'ready to ship')
            ),
            shipment_sku_counts AS (
                SELECT s.shipment_id, COUNT(DISTINCT s.sku) as sku_count
                FROM accounting_inbound_shipments s
                JOIN stores st ON s.store_id = st.id
                WHERE UPPER(st.name) = UPPER(%s)
                  AND s.shipment_id IN (SELECT shipment_id FROM disc_shipments)
                  AND s.deleted_at IS NULL
                GROUP BY s.shipment_id
            )
            SELECT 
                s.shipment_id,
                c.sku_count,
                s.sku,
                COALESCE(m.asin, '') as asin,
                s.quantity as amazon_received,
                COALESCE(s.so_luong_amazon_nhan, 0) as so_luong_amazon_nhan,
                s.discrepancy,
                COALESCE(s.ngay_den, '') as receiving_date,
                COALESCE(s.status, '') as status
            FROM accounting_inbound_shipments s
            JOIN shipment_sku_counts c ON s.shipment_id = c.shipment_id
            JOIN stores st ON s.store_id = st.id
            LEFT JOIN accounting_sku_master m ON (s.sku_id = m.id OR (s.store_id = m.store_id AND LOWER(TRIM(s.sku)) = LOWER(TRIM(m.sku))))
            WHERE UPPER(st.name) = UPPER(%s)
              AND s.deleted_at IS NULL
              AND LOWER(TRIM(COALESCE(s.status, ''))) NOT IN ('in transit', 'working', 'shipped', 'ready to ship')
            ORDER BY c.sku_count DESC, s.shipment_id, s.sku;
        """
        cur.execute(query, (store_name, store_name, store_name))
        rows = cur.fetchall()

        single_sku_items = []
        multi_sku_shipments = []

        seen_multi = set()
        for r in rows:
            shipment_id = r[0].strip()
            sku_count = r[1]
            sku = r[2].strip()
            asin = r[3].strip()
            amazon_received = int(r[4] or 0)
            so_luong_amazon_nhan = int(r[5] or 0)
            discrepancy = int(r[6] or 0)
            receiving_date = r[7].strip()
            raw_status = r[8].strip()

            status = raw_status if raw_status and raw_status.lower() != "null" else "Closed"

            if sku_count == 1:
                # 1 SKU: mặc định con đó lệch luôn
                single_sku_items.append({
                    "store": store_name,
                    "sku": sku,
                    "asin": asin,
                    "shipment_id": shipment_id,
                    "amazon_received": amazon_received,
                    "so_luong_amazon_nhan": so_luong_amazon_nhan,
                    "discrepancy": discrepancy,
                    "receiving_date": receiving_date,
                    "status": status
                })
            else:
                # > 1 SKU: cần crawl chi tiết trên Amazon Seller Central
                if shipment_id not in seen_multi:
                    seen_multi.add(shipment_id)
                    multi_sku_shipments.append(shipment_id)

        print(json.dumps({
            "store": store_name,
            "total_single_sku_items": len(single_sku_items),
            "total_multi_sku_shipments": len(multi_sku_shipments),
            "single_sku_items": single_sku_items,
            "multi_sku_shipments": multi_sku_shipments
        }))
        conn.close()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
