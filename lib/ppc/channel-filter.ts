import "server-only";

import type postgres from "postgres";
import { getAccountingStoreForPpcStore } from "@/lib/ppc/sku-architecture-service";

/**
 * Kênh FBA / FBM của store có Bảng mã FBM (FASTPEACE). Ô chọn store tách sẵn "FASTPEACE · FBA" / "FASTPEACE · FBM",
 * mọi tab PPC gửi kèm `channel=FBA|FBM`; store không chia kênh thì bỏ qua tham số này.
 *
 * Quy tắc xếp 1 campaign vào kênh (đo trên FASTPEACE 30 ngày: khớp ~100% spend với chữ FBA/FBM trong tên):
 *  1. Từ đầu tiên của tên campaign là SKU → tra Bảng mã: có trong bảng mã FBM → FBM, có trong bảng mã FBA → FBA;
 *  2. không thì tên campaign có chữ FBM / FBA;
 *  3. không thì tên portfolio có chữ FBM / FBA;
 *  4. còn lại là "Khác" — không thuộc kênh nào (thực tế các campaign này spend $0).
 */
export type PpcChannel = "FBA" | "FBM";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = postgres.Sql<any>;

export function parsePpcChannel(value: string | null | undefined): PpcChannel | null {
  const v = (value || "").trim().toUpperCase();
  return v === "FBA" || v === "FBM" ? v : null;
}

const FBM_RE = "(^|[^a-z])fbm([^a-z]|$)";
const FBA_RE = "(^|[^a-z])fba([^a-z]|$)";

const accountingIdCache = new Map<string, { id: string | null; expiresAt: number }>();
const CACHE_MS = 10 * 60_000;

/** Id store Accounting (chứa Bảng mã) của store PPC; null nếu store không có Bảng mã FBM → không chia kênh. */
export async function channelAccountingStoreId(sql: Db, storeName: string): Promise<string | null> {
  if (!storeName || storeName === "ALL") return null;
  const key = storeName.toUpperCase();
  const hit = accountingIdCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.id;
  let id: string | null = null;
  const acc = await getAccountingStoreForPpcStore(storeName).catch(() => null);
  if (acc) {
    const rows = await sql<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM accounting_sku_master_fbm
        WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
      ) AS ok
    `;
    if (rows[0]?.ok) id = acc.accountingStoreId;
  }
  accountingIdCache.set(key, { id, expiresAt: Date.now() + CACHE_MS });
  return id;
}

/** Store nào chia kênh FBA / FBM (để ô chọn store hiện 2 dòng). */
export async function storeHasChannels(sql: Db, storeName: string): Promise<boolean> {
  return (await channelAccountingStoreId(sql, storeName)) !== null;
}

export interface PpcChannelScope {
  channel: PpcChannel;
  accountingStoreId: string;
}

/** Chuẩn hoá tham số kênh của 1 request: null nếu không lọc (không có channel, All Stores, store không chia kênh). */
export async function resolvePpcChannelScope(
  sql: Db,
  storeName: string,
  channelParam: string | null | undefined,
): Promise<PpcChannelScope | null> {
  const channel = parsePpcChannel(channelParam);
  if (!channel || !storeName || storeName === "ALL") return null;
  const accountingStoreId = await channelAccountingStoreId(sql, storeName);
  return accountingStoreId ? { channel, accountingStoreId } : null;
}

/**
 * Điều kiện SQL "dòng thuộc kênh đang chọn". `campaignCol` / `portfolioCol` / `skuCol` là tên cột cố định trong code
 * (không bao giờ lấy từ người dùng). Có `skuCol` (bảng theo SKU) thì xét SKU đó thay cho từ đầu tên campaign.
 * scope null → TRUE (không lọc).
 */
export function ppcChannelWhere(
  sql: Db,
  scope: PpcChannelScope | null,
  cols: { campaignCol?: string; portfolioCol?: string; skuCol?: string },
): postgres.Fragment {
  if (!scope) return sql`TRUE`;
  const id = scope.accountingStoreId;
  const tok = cols.skuCol
    ? sql.unsafe(`upper(trim(${cols.skuCol}))`)
    : sql.unsafe(`upper(split_part(trim(${cols.campaignCol}), ' ', 1))`);
  const camp = cols.campaignCol ? sql.unsafe(`COALESCE(${cols.campaignCol}, '')`) : sql`''`;
  const port = cols.portfolioCol ? sql.unsafe(`COALESCE(${cols.portfolioCol}, '')`) : sql`''`;
  return sql`(
    CASE
      WHEN ${tok} IN (SELECT upper(trim(m.sku)) FROM accounting_sku_master_fbm m WHERE m.store_id = ${id} AND m.deleted_at IS NULL) THEN 'FBM'
      WHEN ${tok} IN (SELECT upper(trim(m.sku)) FROM accounting_sku_master m WHERE m.store_id = ${id} AND m.deleted_at IS NULL) THEN 'FBA'
      WHEN ${camp} ~* ${FBM_RE} THEN 'FBM'
      WHEN ${camp} ~* ${FBA_RE} THEN 'FBA'
      WHEN ${port} ~* ${FBM_RE} THEN 'FBM'
      WHEN ${port} ~* ${FBA_RE} THEN 'FBA'
      ELSE 'OTHER'
    END
  ) = ${scope.channel}`;
}

/** Phần thêm vào cache key để mỗi kênh có cache riêng. */
export function channelCacheSuffix(scope: PpcChannelScope | null): string {
  return scope ? `:ch=${scope.channel}` : "";
}
