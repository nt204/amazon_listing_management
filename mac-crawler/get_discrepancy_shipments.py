#!/usr/bin/env python3
"""
get_discrepancy_shipments.py
Truy vấn danh sách shipment có discrepancy lệch từ bảng accounting_inbound_shipments.
Quy tắc:
- Chỉ lấy các lô hàng ĐÃ ĐẾN KHO hoặc ĐANG NHẬN (loại trừ In transit, Working, Shipped).
- Lô nào chỉ có 1 SKU -> Mặc định con đó lệch luôn, lấy trực tiếp từ DB kèm ASIN từ bảng mã.
- Lô > 1 SKU mà mọi SKU đã có số nhận (amazon_received) và tổng khớp số nhận của lô -> tính luôn từ DB.
- Lô > 1 SKU còn lại -> Cần mở Seller Central để check xem chính xác SKU/ASIN nào bị lệch bao nhiêu.
- Dấu discrepancy đầu ra giống Seller Central: số nhận - số gửi (âm = thiếu).
- Khôi phục cache tự động từ bảng accounting_shipment_discrepancies nếu mất file cache.
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

        # Nếu gọi với lệnh --load-all-cached: tải lại toàn bộ cache đã lưu vĩnh viễn trên DB
        if store_name == "--load-all-cached":
            cur.execute("""
                SELECT store_name, sku, asin, shipment_id, amazon_received, 
                       so_luong_amazon_nhan, discrepancy, receiving_date, status
                FROM accounting_shipment_discrepancies;
            """)
            db_rows = cur.fetchall()
            cached_data = {}
            for r in db_rows:
                st = r[0]
                item = {
                    "store": st,
                    "sku": r[1],
                    "asin": r[2] or "",
                    "shipment_id": r[3],
                    "amazon_received": r[4],
                    "so_luong_amazon_nhan": r[5],
                    "discrepancy": r[6],
                    "receiving_date": r[7] or "",
                    "status": r[8] or "Action required"
                }
                if st not in cached_data:
                    cached_data[st] = {}
                sid = r[3]
                if sid not in cached_data[st]:
                    cached_data[st][sid] = {
                        "shipment_id": sid,
                        "store": st,
                        "items": [],
                        "receivingDate": r[7] or "",
                        "last_checked_at": ""
                    }
                cached_data[st][sid]["items"].append(item)
            print(json.dumps(cached_data))
            conn.close()
            return

        # Quét các shipment có discrepancy != 0 từ accounting_inbound_shipments.
        # Quy ước dấu ĐẦU RA (giống Seller Central): discrepancy = số Amazon nhận - số gửi → ÂM = THIẾU, DƯƠNG = THỪA.
        # (Cột discrepancy trong bảng Chi tiết đi hàng ngược dấu: số gửi - số nhận, dương = thiếu → không dùng thẳng.)
        # Lô chưa nhận xong / chưa gửi / lỗi dữ liệu thì bỏ qua.
        query = """
            WITH base AS (
                SELECT s.*
                FROM accounting_inbound_shipments s
                JOIN stores st ON s.store_id = st.id
                WHERE UPPER(st.name) = UPPER(%s)
                  AND s.deleted_at IS NULL
                  AND s.shipment_id IS NOT NULL
                  AND TRIM(s.shipment_id) != ''
                  AND LOWER(TRIM(COALESCE(s.status, ''))) NOT IN (
                    'in transit', 'working', 'shipped', 'ready to ship', 'created', 'delivered',
                    'cancelled', 'canceled', 'deleted', '[object object]'
                  )
            ),
            disc_shipments AS (
                SELECT DISTINCT shipment_id FROM base WHERE COALESCE(discrepancy, 0) != 0
            ),
            lot AS (
                SELECT shipment_id,
                       COUNT(DISTINCT UPPER(TRIM(sku))) AS sku_count,
                       COUNT(*) FILTER (WHERE amazon_received IS NULL) AS missing_sku_received,
                       SUM(amazon_received) AS sum_sku_received,
                       MAX(so_luong_amazon_nhan) AS lot_received,
                       MAX(TRIM(COALESCE(status, ''))) AS lot_status
                FROM base
                WHERE shipment_id IN (SELECT shipment_id FROM disc_shipments)
                GROUP BY shipment_id
            )
            SELECT
                b.shipment_id,
                l.sku_count,
                b.sku,
                COALESCE((
                    SELECT m.asin FROM accounting_sku_master m
                    WHERE m.deleted_at IS NULL
                      AND (m.id = b.sku_id OR (m.store_id = b.store_id AND LOWER(TRIM(m.sku)) = LOWER(TRIM(b.sku))))
                    ORDER BY (m.id = b.sku_id) DESC NULLS LAST
                    LIMIT 1
                ), '') AS asin,
                COALESCE(b.quantity, 0) AS quantity,
                b.amazon_received,
                b.so_luong_amazon_nhan,
                b.discrepancy,
                COALESCE(b.ngay_den, '') AS receiving_date,
                COALESCE(l.lot_status, '') AS lot_status,
                -- Lô nhiều SKU tự tính được từ bảng khi mọi SKU đã có số nhận và tổng khớp số nhận của lô
                (l.missing_sku_received = 0 AND (l.lot_received IS NULL OR l.lot_received = l.sum_sku_received)) AS resolvable,
                -- Units located của Amazon (báo cáo Check Shipment) cho cả lô
                (
                    SELECT c.units_located FROM accounting_amazon_check_shipments c
                    WHERE c.store_id = b.store_id AND c.deleted_at IS NULL
                      AND LOWER(TRIM(c.shipment_id)) = LOWER(TRIM(b.shipment_id))
                    ORDER BY c.updated_at DESC
                    LIMIT 1
                ) AS check_located,
                (
                    SELECT c.units_expected FROM accounting_amazon_check_shipments c
                    WHERE c.store_id = b.store_id AND c.deleted_at IS NULL
                      AND LOWER(TRIM(c.shipment_id)) = LOWER(TRIM(b.shipment_id))
                    ORDER BY c.updated_at DESC
                    LIMIT 1
                ) AS check_expected
            FROM base b
            JOIN lot l ON l.shipment_id = b.shipment_id
            ORDER BY l.sku_count DESC, b.shipment_id, b.sku;
        """
        cur.execute(query, (store_name,))
        rows = cur.fetchall()

        single_sku_items = []
        db_resolved_items = []
        multi_sku_shipments = []
        shipment_status = {}

        seen_multi = set()
        single_lots = {}  # lô 1 SKU: gom các dòng cùng SKU (sheet có thể ghi 1 SKU thành nhiều dòng)
        for r in rows:
            shipment_id = (r[0] or "").strip()
            sku_count = r[1]
            sku = (r[2] or "").strip()
            asin = (r[3] or "").strip()
            quantity = int(r[4] or 0)
            sku_received = r[5]
            lot_received = r[6]
            raw_disc = int(r[7] or 0)
            receiving_date = (r[8] or "").strip()
            lot_status = (r[9] or "").strip()
            resolvable = bool(r[10])
            check_located = r[11]
            check_expected = r[12]

            status = lot_status if lot_status else "Closed"
            shipment_status[shipment_id] = status

            if sku_count == 1:
                # Lô 1 SKU: lô thiếu/thừa bao nhiêu thì chính SKU đó thiếu/thừa bấy nhiêu.
                # Số nhận ưu tiên Units located của Amazon (Check Shipment), rồi số nhận của lô trong bảng,
                # cuối cùng mới tới Amazon Received trên sheet (hay bị ghi bằng số đi → che mất phần thiếu).
                lot = single_lots.get(shipment_id)
                if lot is None:
                    lot = single_lots[shipment_id] = {
                        "sku": sku, "asin": asin, "quantity": 0, "sheet_received": None,
                        "lot_received": lot_received, "check_located": check_located, "check_expected": check_expected,
                        "receiving_date": receiving_date, "status": status, "raw_disc": 0,
                    }
                lot["quantity"] += quantity
                lot["raw_disc"] += raw_disc
                if sku_received is not None:
                    lot["sheet_received"] = (lot["sheet_received"] or 0) + int(sku_received)
                if not lot["asin"] and asin:
                    lot["asin"] = asin
            elif resolvable:
                received = int(sku_received or 0)
                db_resolved_items.append({
                    "store": store_name,
                    "sku": sku,
                    "asin": asin,
                    "shipment_id": shipment_id,
                    "amazon_received": quantity,
                    "so_luong_amazon_nhan": received,
                    "discrepancy": received - quantity,
                    "receiving_date": receiving_date,
                    "status": status
                })
            else:
                if shipment_id not in seen_multi:
                    seen_multi.add(shipment_id)
                    multi_sku_shipments.append(shipment_id)

        for shipment_id, lot in single_lots.items():
            # Số phải nhận = Units expected của Amazon (giống Seller Central), chưa có thì số đi trên sheet
            quantity = int(lot["check_expected"]) if lot["check_expected"] is not None else lot["quantity"]
            if lot["check_located"] is not None:
                received = int(lot["check_located"])
            elif lot["lot_received"] is not None:
                received = int(lot["lot_received"])
            elif lot["sheet_received"] is not None:
                received = lot["sheet_received"]
            else:
                received = quantity - lot["raw_disc"]
            single_sku_items.append({
                "store": store_name,
                "sku": lot["sku"],
                "asin": lot["asin"],
                "shipment_id": shipment_id,
                "amazon_received": quantity,
                "so_luong_amazon_nhan": received,
                "discrepancy": received - quantity,
                "receiving_date": lot["receiving_date"],
                "status": lot["status"]
            })

        print(json.dumps({
            "store": store_name,
            "total_single_sku_items": len(single_sku_items),
            "total_multi_sku_shipments": len(multi_sku_shipments),
            "single_sku_items": single_sku_items,
            "db_resolved_items": db_resolved_items,
            "multi_sku_shipments": multi_sku_shipments,
            "shipment_status": shipment_status
        }))
        conn.close()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
