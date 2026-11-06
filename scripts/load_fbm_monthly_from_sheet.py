#!/usr/bin/env python3
"""
Nạp SKU FBM-monthly các tháng chưa có file thô Amazon (2026-01..08) từ Google Sheet "TỔNG KẾT CUỐI THÁNG_<STORE> 2026".

Tab SKU FBM-monthly chỉ hiện 1 tháng (ô C1..E1) nên script tính lại công thức của tab (scripts/fbm_monthly_engine.py)
trên các tab nguồn Basecost / Trans Rp / Ads / BẢNG MÃ cho từng tháng. Trước khi ghi, tính tháng đang hiện trên tab và
so từng SKU với số trên tab — lệch thì dừng (công thức tab đã đổi, cần sửa engine).

Kỳ nạp từ sheet được đánh dấu data_source = 'file' trong accounting_fbm_monthly_store_summary.

  python3 scripts/load_fbm_monthly_from_sheet.py --sheet <link> --months 1-8            # chỉ tính + kiểm tra
  python3 scripts/load_fbm_monthly_from_sheet.py --sheet <link> --months 1-8 --write    # ghi DB (DATABASE_URL)

Cần .env có GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, sheet chia sẻ cho email bot,
và thư viện cryptography (ký JWT).
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fbm_monthly_engine import (  # noqa: E402
    FBM_OWNER_FEE_STORES, compute_fbm_month, dedupe_rows, month_of, num, summarize,
)
from google_sheets_client import parse_spreadsheet_id, read_columns, read_ranges  # noqa: E402

FBM_TAB = 'SKU FBM-monthly'
YEAR = 2026


def load_env_file(path):
    """Chỉ lấy các biến cần (file .env có dòng không theo cú pháp shell nên không source được)."""
    if not os.path.exists(path):
        return
    text = open(path, encoding='utf-8').read()
    for name in ('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'DATABASE_URL'):
        if os.environ.get(name):
            continue
        m = re.search(r'^' + name + r'=(.*)$', text, re.M)
        if m:
            os.environ[name] = m.group(1).strip().strip('"').strip("'")


def read_sources(sid):
    print('📥 Đọc tab Basecost / Trans Rp / Ads / BẢNG MÃ...')
    basecost = read_columns(sid, 'Basecost', ['A', 'D', 'E', 'L', 'M', 'P', 'Q', 'U', 'X'])
    trans = read_columns(sid, 'Trans Rp', ['C', 'E', 'AD', 'AE', 'AI', 'AM'])
    ads = read_columns(sid, 'Ads', ['A', 'B', 'L', 'O', 'X', 'AD'])
    bangma = read_columns(sid, 'BẢNG MÃ', ['A', 'B', 'D', 'E', 'J', 'M'])
    return (
        [{'month': month_of(r[0]), 'sku': r[1], 'sales': num(r[3]), 'qty': num(r[4]),
          'amz_fee': num(r[5]), 'tax': num(r[6]), 'basecost': num(r[7]),
          'trans_status': str(r[8] or '').lower()} for r in basecost[1:]],
        [{'type': str(r[0] or ''), 'sku': r[1], 'total': num(r[2]), 'month': month_of(r[3]),
          'order_month': month_of(r[4]), 'order_fee': num(r[5])} for r in trans[1:]],
        [{'month': month_of(r[0]), 'portfolio': r[1], 'spend': num(r[2]), 'sales': num(r[3]), 'sku': r[4],
          'tax': num(r[5])} for r in ads[1:]],
        bangma,
    )


def fbm_skus(bangma, store):
    # Cột ASIN của tab = XLOOKUP(store|SKU) → ASIN của dòng BẢNG MÃ đầu tiên trùng store + SKU
    first_asin = {}
    for r in bangma[1:]:
        if str(r[0] or '').strip().upper() == store and r[2] not in (None, ''):
            first_asin.setdefault(str(r[2]).upper(), r[3])
    return [
        {'sku': r[2], 'asin': first_asin.get(str(r[2]).upper()), 'product_type': r[1], 'status': r[5]}
        for r in bangma[1:]
        if str(r[0] or '').strip().upper() == store and str(r[4] or '').strip().upper() == 'FBM' and r[2] not in (None, '')
    ]


def check_against_tab(sid, store, skus, sources, owner_fee):
    """Tính tháng đang hiện trên tab SKU FBM-monthly và so với số trên tab."""
    tab = read_ranges(sid, [f"'{FBM_TAB}'!A1:AD"])[0]
    shown = month_of(tab[0][2]) if tab and len(tab[0]) > 2 else None
    if shown is None or month_of(tab[0][4]) != shown:
        raise SystemExit(f'Tab {FBM_TAB} không chọn đúng 1 tháng (C1..E1) — không kiểm tra được')
    rows, summary = compute_fbm_month(skus, *sources[:3], shown, owner_fee)
    cols = [(4, 'revenue'), (5, 'quantity'), (6, 'ads_fee'), (7, 'basecost'), (8, 'amazon_fee_unrecognized'),
            (9, 'amazon_fee_trans'), (10, 'thue'), (11, 'return_amount'), (12, 'a_to_z_claim'),
            (13, 'chargeback_refund'), (14, 'profit'), (29, 'revenue_ads')]
    sheet_rows = [r for r in tab[3:] if len(r) > 2 and r[2] not in (None, '') and not str(r[2]).startswith('#')]
    bad = []
    for i, (calc, sheet) in enumerate(zip(rows, sheet_rows)):
        if str(calc['sku']) != str(sheet[2]):
            raise SystemExit(f'Thứ tự SKU khác tab ở dòng {i + 4}: {calc["sku"]!r} vs {sheet[2]!r}')
        for idx, name in cols:
            if name == 'revenue_ads':
                continue  # AD (Revenue ads) không tính vào lợi nhuận; ô có thể lỗi #N/A
            a = calc[name]
            b = num(sheet[idx]) if idx < len(sheet) else 0.0
            if abs(a - b) > 0.005:
                bad.append((calc['sku'], name, round(b, 4), round(a, 4)))
    if len(rows) != len(sheet_rows):
        bad.append(('(số dòng)', 'count', len(sheet_rows), len(rows)))
    net_sheet = num(tab[1][14])
    print(f'🔎 Kiểm tra tháng {shown} với tab {FBM_TAB}: {len(rows)} SKU, Profit tab {net_sheet:.2f} / tính {summary["net_profit"]:.2f}')
    if abs(net_sheet - summary['net_profit']) > 0.01:
        bad.append(('(tổng)', 'net_profit', round(net_sheet, 4), round(summary['net_profit'], 4)))
    if bad:
        for b in bad[:30]:
            print('   ❌', b)
        raise SystemExit(f'Công thức tính lệch tab {FBM_TAB} ({len(bad)} ô) — không ghi DB')
    print('   ✅ Khớp từng SKU')


def write_month(conn, store_id, month, rows, summary, data_source):
    from fbm_monthly_db import upsert_fbm_month
    upsert_fbm_month(conn, store_id, YEAR, month, rows, summary, data_source)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sheet', required=True, help='Link / ID Google Sheet TỔNG KẾT CUỐI THÁNG của store')
    parser.add_argument('--months', default='1-8', help='VD 1-8 hoặc 3')
    parser.add_argument('--write', action='store_true', help='Ghi vào DB (mặc định chỉ tính + kiểm tra)')
    parser.add_argument('--env', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))
    args = parser.parse_args()
    load_env_file(args.env)

    sid = parse_spreadsheet_id(args.sheet)
    a, _, b = args.months.partition('-')
    months = list(range(int(a), int(b or a) + 1))

    store = str(read_ranges(sid, [f"'{FBM_TAB}'!A1"])[0][0][0]).strip().upper()
    owner_fee = store in FBM_OWNER_FEE_STORES
    print(f'🏪 {store} | tháng {months} | phí chủ store: {owner_fee}')

    sources = read_sources(sid)
    skus = fbm_skus(sources[3], store)
    print(f'📦 {len(skus)} dòng SKU FBM trong BẢNG MÃ')
    check_against_tab(sid, store, skus, sources, owner_fee)

    conn = None
    store_id = None
    if args.write:
        import psycopg2
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
        cur = conn.cursor()
        cur.execute('SELECT id FROM stores WHERE UPPER(TRIM(name)) = %s', (store,))
        found = cur.fetchone()
        if not found:
            raise SystemExit(f'Không có store {store} trong DB')
        store_id = found[0]

    for month in months:
        rows, summary = compute_fbm_month(skus, *sources[:3], month, owner_fee)
        unique, dropped = dedupe_rows(rows)
        if dropped:
            print(f'   ⚠️ Tháng {month}: bỏ {len(dropped)} dòng SKU lặp trong BẢNG MÃ: {dropped[:5]}')
        summary = summarize(unique, month, owner_fee)
        print(f'📊 {store} {YEAR}-{month:02d}: Revenue {summary["revenue"]:.2f} | Qty {summary["quantity"]:.0f} | '
              f'Profit {summary["profit"]:.2f} | Phí chủ {summary["owner_fee"]:.2f} | Net {summary["net_profit"]:.2f} | '
              f'{summary["active_sku_count"]} SKU có phát sinh')
        if conn:
            write_month(conn, store_id, month, unique, summary, 'file')
    if conn:
        conn.commit()
        conn.close()
        print('✅ Đã ghi DB')
    else:
        print('⚡ Chưa ghi DB (thêm --write)')


if __name__ == '__main__':
    main()
