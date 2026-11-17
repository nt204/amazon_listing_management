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

interface CachedChannelData {
  accountingStoreId: string | null;
  fbmSkus: string[];
  fbaSkus: string[];
  expiresAt: number;
}

const channelDataCache = new Map<string, CachedChannelData>();
const CACHE_MS = 10 * 60_000;

async function getChannelStoreData(sql: Db, storeName: string): Promise<CachedChannelData> {
  if (!storeName || storeName === "ALL") {
    return { accountingStoreId: null, fbmSkus: [], fbaSkus: [], expiresAt: Date.now() + CACHE_MS };
  }
  const key = storeName.toUpperCase().trim();
  const hit = channelDataCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;

  let accountingStoreId: string | null = null;
  let fbmSkus: string[] = [];
  let fbaSkus: string[] = [];

  const acc = await getAccountingStoreForPpcStore(storeName).catch(() => null);
  if (acc) {
    const [fbmRows, fbaRows] = await Promise.all([
      sql<{ sku: string }[]>`
        SELECT DISTINCT upper(trim(sku)) AS sku
        FROM accounting_sku_master_fbm
        WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
      `,
      sql<{ sku: string }[]>`
        SELECT DISTINCT upper(trim(sku)) AS sku
        FROM accounting_sku_master
        WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
      `,
    ]);

    if (fbmRows.length > 0) {
      accountingStoreId = acc.accountingStoreId;
      fbmSkus = fbmRows.map((r) => r.sku);
      fbaSkus = fbaRows.map((r) => r.sku);
    }
  }

  const result: CachedChannelData = {
    accountingStoreId,
    fbmSkus,
    fbaSkus,
    expiresAt: Date.now() + CACHE_MS,
  };
  channelDataCache.set(key, result);
  return result;
}

/** Id store Accounting (chứa Bảng mã) của store PPC; null nếu store không có Bảng mã FBM → không chia kênh. */
export async function channelAccountingStoreId(sql: Db, storeName: string): Promise<string | null> {
  const data = await getChannelStoreData(sql, storeName);
  return data.accountingStoreId;
}

/** Store nào chia kênh FBA / FBM (để ô chọn store hiện 2 dòng). */
export async function storeHasChannels(sql: Db, storeName: string): Promise<boolean> {
  return (await channelAccountingStoreId(sql, storeName)) !== null;
}

export interface PpcChannelScope {
  channel: PpcChannel;
  accountingStoreId: string;
  fbmSkus: string[];
  fbaSkus: string[];
}

/** Chuẩn hoá tham số kênh của 1 request: null nếu không lọc (không có channel, All Stores, store không chia kênh). */
export async function resolvePpcChannelScope(
  sql: Db,
  storeName: string,
  channelParam: string | null | undefined,
): Promise<PpcChannelScope | null> {
  const channel = parsePpcChannel(channelParam);
  if (!channel || !storeName || storeName === "ALL") return null;
  const data = await getChannelStoreData(sql, storeName);
  return data.accountingStoreId
    ? {
        channel,
        accountingStoreId: data.accountingStoreId,
        fbmSkus: data.fbmSkus,
        fbaSkus: data.fbaSkus,
      }
    : null;
}

/**
 * Điều kiện SQL "dòng thuộc kênh đang chọn". `campaignCol` / `portfolioCol` / `skuCol` là tên cột cố định trong code
 * (không bao giờ lấy từ người dùng). Có `skuCol` (bảng theo SKU) thì xét SKU đó thay cho từ đầu tên campaign.
 * scope null → TRUE (không lọc).
 *
 * Tối ưu: Dùng mảng JavaScript fbmSkus / fbaSkus đã cache (ANY($1::text[])) thay vì subquery IN (SELECT ...)
 * bên trong CASE WHEN, giúp Postgres hash và tránh quét lặp (correlated subquery) trên hàng triệu dòng facts.
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

  // Ưu tiên mảng SKU đã cache (bộ nhớ Node.js) để tránh subquery quét lặp hàng triệu dòng facts;
  // nếu chưa có mảng thì fallback sang subquery an toàn.
  const hasFbmList = Array.isArray(scope.fbmSkus) && scope.fbmSkus.length > 0;
  const hasFbaList = Array.isArray(scope.fbaSkus) && scope.fbaSkus.length > 0;
  const fbmCond = hasFbmList
    ? sql`${tok} = ANY(${scope.fbmSkus}::text[])`
    : sql`${tok} IN (
        SELECT upper(trim(m.sku)) FROM accounting_sku_master_fbm m
        WHERE m.store_id = ${id} AND m.deleted_at IS NULL AND trim(m.sku) <> ''
      )`;
  const fbaCond = hasFbaList
    ? sql`${tok} = ANY(${scope.fbaSkus}::text[])`
    : sql`${tok} IN (
        SELECT upper(trim(m.sku)) FROM accounting_sku_master m
        WHERE m.store_id = ${id} AND m.deleted_at IS NULL AND trim(m.sku) <> ''
      )`;

  return sql`(
    CASE
      WHEN ${fbmCond} THEN 'FBM'
      WHEN ${fbaCond} THEN 'FBA'
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
