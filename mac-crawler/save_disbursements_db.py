#!/usr/bin/env python3
"""
save_disbursements_db.py
Lưu / Upsert hàng loạt các bản ghi đối soát tiền về (Disbursements) vào PostgreSQL.
Sử dụng execute_batch để gửi toàn bộ dữ liệu trong 1 round-trip cực nhanh (< 0.2s).
"""

import sys
import json
import os
import psycopg2
from psycopg2.extras import execute_batch, Json

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
                if k not in os.environ:
                    os.environ[k] = v

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(script_dir, "config.env"))

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[DB Error] Không tìm thấy DATABASE_URL trong môi trường hoặc config.env", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            payload = json.load(f)
    else:
        payload = json.load(sys.stdin)

    items = payload if isinstance(payload, list) else payload.get("items", [])
    if not items:
        print(json.dumps({"success": True, "saved": 0, "total": 0}))
        return

    conn = psycopg2.connect(db_url, connect_timeout=10)
    cur = conn.cursor()

    upsert_sql_trace = """
        INSERT INTO accounting_payout_disbursements (
            team_id, store_name, currency, payout_amount, payout_status,
            acknowledged_at, acknowledged_date, trace_id, settlement_group,
            period_start, period_end, period_raw, raw_metadata,
            created_at, updated_at
        ) VALUES (
            'default', %s, 'USD', %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (store_name, trace_id) WHERE trace_id IS NOT NULL AND trace_id <> ''
        DO UPDATE SET
            payout_amount = EXCLUDED.payout_amount,
            payout_status = EXCLUDED.payout_status,
            acknowledged_at = EXCLUDED.acknowledged_at,
            acknowledged_date = EXCLUDED.acknowledged_date,
            settlement_group = EXCLUDED.settlement_group,
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            raw_metadata = EXCLUDED.raw_metadata,
            updated_at = NOW();
    """

    upsert_sql_group = """
        INSERT INTO accounting_payout_disbursements (
            team_id, store_name, currency, payout_amount, payout_status,
            acknowledged_at, acknowledged_date, trace_id, settlement_group,
            period_start, period_end, period_raw, raw_metadata,
            created_at, updated_at
        ) VALUES (
            'default', %s, 'USD', %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (store_name, settlement_group, acknowledged_at) WHERE (trace_id IS NULL OR trace_id = '') AND settlement_group IS NOT NULL
        DO UPDATE SET
            payout_amount = EXCLUDED.payout_amount,
            payout_status = EXCLUDED.payout_status,
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            raw_metadata = EXCLUDED.raw_metadata,
            updated_at = NOW();
    """

    params_trace = []
    params_group = []

    for it in items:
        store_name = (it.get("store_name") or "").strip().upper()
        amount = float(it.get("payout_amount") or 0)
        status = (it.get("payout_status") or "Done").strip()
        ack_at = it.get("acknowledged_at")
        ack_date = it.get("acknowledged_date") or (ack_at[:10] if ack_at else None)
        trace_id = (it.get("trace_id") or "").strip() or None
        group_id = (it.get("settlement_group") or "").strip() or None
        p_start = it.get("period_start")
        p_end = it.get("period_end")
        p_raw = it.get("period_raw")
        meta = Json(it.get("raw_metadata") or {})

        if not store_name or amount <= 0:
            continue

        row_tuple = (
            store_name, amount, status,
            ack_at, ack_date, trace_id, group_id,
            p_start, p_end, p_raw, meta
        )

        if trace_id:
            params_trace.append(row_tuple)
        elif group_id and ack_at:
            params_group.append(row_tuple)

    if params_trace:
        execute_batch(cur, upsert_sql_trace, params_trace, page_size=200)

    if params_group:
        execute_batch(cur, upsert_sql_group, params_group, page_size=200)

    conn.commit()
    cur.close()
    conn.close()

    result = {
        "success": True,
        "saved": len(params_trace) + len(params_group),
        "total": len(items)
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
