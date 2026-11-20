// Lên camp SKU mới — dữ liệu: thông tin SKU từ BẢNG MÃ (thay Google Sheets của tool cũ)
// và kho file keyword (thay SQLite kw_files).
import { getDatabaseClient } from "@/lib/db";
import type { NewCampSkuInfo } from "./new-camp-generator";
import { BRAND_ENTITY_PATTERN, storeKey, type StoreSbDefaults } from "./new-camp-fields";

type SkuRow = {
  sku: string;
  product_type: string | null;
  niche: string | null;
  pic_mkt: string | null;
  brand: string | null;
  brand_entity_id: string | null;
  creative_asins_video: string | null;
  creative_asins_collection: string | null;
  video_media_ids: string | null;
  creative_headline: string | null;
  brand_logo_asset_id: string | null;
  landing_page_url: string | null;
  store_name: string | null;
  asin: string | null;
  mockup_url: string | null;
  status: string | null;
};

/**
 * Danh sách SKU theo loại hình: FBA = BẢNG MÃ (accounting_sku_master), FBM = BẢNG MÃ FBM.
 * SKU trùng (nhiều store / nhiều ASIN) lấy dòng điền đủ thông tin nhất, như tool cũ gộp các sheet.
 */
// ---------------------------------------------------------------------------
// Brand Entity ID theo store
// ---------------------------------------------------------------------------

const LOGO_PATTERN = /^amzn1\.assetlibrary\.asset1\.[a-z0-9]+(:version_v\d+)?$/i;

let brandCache: { at: number; entities: Map<string, string>; logos: Map<string, string> } | null = null;

async function getStoreBrandConfig() {
  if (brandCache && Date.now() - brandCache.at < 60_000) return brandCache;
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_name: string; brand_entity_id: string | null; brand_logo_asset_id: string | null }[]>`
    SELECT store_name, brand_entity_id, brand_logo_asset_id FROM ppc_store_brand_entities
  `;
  const entities = new Map<string, string>();
  const logos = new Map<string, string>();
  for (const r of rows) {
    if (r.brand_entity_id) entities.set(storeKey(r.store_name), r.brand_entity_id);
    if (r.brand_logo_asset_id) logos.set(storeKey(r.store_name), r.brand_logo_asset_id);
  }
  brandCache = { at: Date.now(), entities, logos };
  return brandCache;
}

export async function getStoreBrandEntities(): Promise<Map<string, string>> {
  return (await getStoreBrandConfig()).entities;
}

export interface StoreBrandRow {
  store: string;
  brandEntityId: string;
  brandLogoAssetId: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Danh sách store trong Bảng mã + Entity / Logo đã lưu (để xem / sửa trên web). */
export async function listStoreBrandEntities(): Promise<StoreBrandRow[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ store: string; brand_entity_id: string | null; brand_logo_asset_id: string | null; updated_by: string | null; updated_at: Date | null }[]>`
    WITH names AS (
      SELECT UPPER(BTRIM(name)) AS store FROM stores WHERE status = 'active'
      UNION SELECT store_name FROM ppc_store_brand_entities
    )
    SELECT n.store, e.brand_entity_id, e.brand_logo_asset_id, e.updated_by, e.updated_at
    FROM names n LEFT JOIN ppc_store_brand_entities e ON e.store_name = n.store
    ORDER BY n.store
  `;
  return rows.map((r) => ({
    store: r.store,
    brandEntityId: r.brand_entity_id || "",
    brandLogoAssetId: r.brand_logo_asset_id || "",
    updatedBy: r.updated_by,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

/** Lưu Entity và/hoặc Logo của store; chuỗi rỗng = xoá trường đó, undefined = giữ nguyên. */
export async function saveStoreBrand(storeName: string, patch: { brandEntityId?: string; brandLogoAssetId?: string }, userId: string): Promise<void> {
  const store = storeKey(storeName);
  if (!store) throw new Error("Thiếu tên store.");
  const entity = patch.brandEntityId?.trim().toUpperCase();
  const logo = patch.brandLogoAssetId?.trim();
  if (entity && !BRAND_ENTITY_PATTERN.test(entity)) throw new Error("Brand Entity ID phải dạng ENTITY + chữ/số.");
  if (logo && !LOGO_PATTERN.test(logo)) throw new Error("Logo Asset ID phải dạng amzn1.assetlibrary.asset1…");
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO ppc_store_brand_entities (store_name, brand_entity_id, brand_logo_asset_id, updated_by, updated_at)
    VALUES (${store}, ${entity || null}, ${logo || null}, ${userId}, NOW())
    ON CONFLICT (store_name) DO UPDATE SET
      brand_entity_id = CASE WHEN ${entity !== undefined} THEN EXCLUDED.brand_entity_id ELSE ppc_store_brand_entities.brand_entity_id END,
      brand_logo_asset_id = CASE WHEN ${logo !== undefined} THEN EXCLUDED.brand_logo_asset_id ELSE ppc_store_brand_entities.brand_logo_asset_id END,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `;
  await sql`DELETE FROM ppc_store_brand_entities WHERE store_name = ${store} AND brand_entity_id IS NULL AND brand_logo_asset_id IS NULL`;
  brandCache = null;
}

/** Mỗi store dùng 1 logo: logo đã lưu theo store, chưa có thì lấy logo nhiều SKU dùng nhất (BẢNG MÃ FBA + FBM). */
async function getStoreLogos(): Promise<Map<string, string>> {
  const sql = await getDatabaseClient();
  const saved = (await getStoreBrandConfig()).logos;
  const rows = await sql<{ store_name: string | null; logo: string; n: number }[]>`
    SELECT s.name AS store_name, BTRIM(m.brand_logo_asset_id) AS logo, COUNT(*)::int AS n
    FROM (
      SELECT store_id, brand_logo_asset_id FROM accounting_sku_master WHERE deleted_at IS NULL
      UNION ALL
      SELECT store_id, brand_logo_asset_id FROM accounting_sku_master_fbm WHERE deleted_at IS NULL
    ) m
    JOIN stores s ON s.id = m.store_id
    WHERE BTRIM(COALESCE(m.brand_logo_asset_id, '')) <> ''
    GROUP BY 1, 2
    ORDER BY n DESC
  `;
  const map = new Map(saved);
  for (const r of rows) {
    const key = storeKey(r.store_name);
    if (key && !map.has(key) && LOGO_PATTERN.test(r.logo)) map.set(key, r.logo);
  }
  return map;
}

/**
 * Thông số SB theo store, dùng chung FBA và FBM: Entity / Logo đã lưu theo store (chưa lưu thì lấy giá trị nhiều SKU
 * dùng nhất), Brand Name nhiều SKU dùng nhất — gom cả BẢNG MÃ FBA lẫn FBM.
 */
export async function getStoreSbDefaults(storeName: string): Promise<StoreSbDefaults> {
  const store = storeKey(storeName);
  const empty = { brandEntityId: "", brandLogoAssetId: "", brand: "" };
  if (!store) return empty;
  const sql = await getDatabaseClient();
  const [entities, logos] = await Promise.all([getStoreBrandEntities(), getStoreLogos()]);
  const top = async (col: "brand" | "brand_entity_id") => {
    const rows = await sql<{ v: string }[]>`
      SELECT BTRIM(m.${sql(col)}) AS v
      FROM (
        SELECT store_id, brand, brand_entity_id FROM accounting_sku_master WHERE deleted_at IS NULL
        UNION ALL
        SELECT store_id, brand, brand_entity_id FROM accounting_sku_master_fbm WHERE deleted_at IS NULL
      ) m
      JOIN stores s ON s.id = m.store_id
      WHERE UPPER(BTRIM(s.name)) = ${store} AND BTRIM(COALESCE(m.${sql(col)}, '')) <> ''
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
    `;
    return rows[0]?.v || "";
  };
  const [brand, entityTop] = await Promise.all([top("brand"), entities.has(store) ? Promise.resolve("") : top("brand_entity_id")]);
  return {
    brandEntityId: entities.get(store) || (BRAND_ENTITY_PATTERN.test(entityTop.toUpperCase()) ? entityTop.toUpperCase() : ""),
    brandLogoAssetId: logos.get(store) || "",
    brand,
  };
}

/** Lên camp từ search term: BẢNG MÃ đang chọn trước, SKU không có thì lấy từ bảng còn lại (FBA ↔ FBM). */
export async function listLaunchSkus(primary: "FBA" | "FBM"): Promise<NewCampSkuInfo[]> {
  const [main, other] = await Promise.all([listNewCampSkus(primary), listNewCampSkus(primary === "FBA" ? "FBM" : "FBA")]);
  const seen = new Set(main.map((x) => x.sku.toUpperCase()));
  return [...main, ...other.filter((x) => !seen.has(x.sku.toUpperCase()))];
}

export async function listNewCampSkus(loaiHinh: "FBA" | "FBM"): Promise<NewCampSkuInfo[]> {
  const sql = await getDatabaseClient();
  const storeEntities = await getStoreBrandEntities();
  const table = loaiHinh === "FBM" ? sql("accounting_sku_master_fbm") : sql("accounting_sku_master");
  const rows = await sql<SkuRow[]>`
    SELECT DISTINCT ON (UPPER(BTRIM(m.sku)))
      BTRIM(m.sku) AS sku,
      BTRIM(m.product_type) AS product_type,
      BTRIM(m.niche) AS niche,
      BTRIM(m.pic_mkt) AS pic_mkt,
      BTRIM(m.brand) AS brand,
      BTRIM(m.brand_entity_id) AS brand_entity_id,
      BTRIM(m.creative_asins_video) AS creative_asins_video,
      BTRIM(m.creative_asins_collection) AS creative_asins_collection,
      BTRIM(m.video_media_ids) AS video_media_ids,
      BTRIM(m.creative_headline) AS creative_headline,
      BTRIM(m.brand_logo_asset_id) AS brand_logo_asset_id,
      BTRIM(m.landing_page_url) AS landing_page_url,
      s.name AS store_name,
      BTRIM(m.asin) AS asin,
      BTRIM(m.status) AS status,
      COALESCE(NULLIF(BTRIM(m.mockup_url), ''), NULLIF(BTRIM(m.mockup), '')) AS mockup_url
    FROM ${table} m
    LEFT JOIN stores s ON s.id = m.store_id
    WHERE m.deleted_at IS NULL AND BTRIM(COALESCE(m.sku, '')) <> ''
    ORDER BY
      UPPER(BTRIM(m.sku)),
      (LOWER(BTRIM(COALESCE(m.status, ''))) IN ('off', 'hủy', 'huỷ', 'cũ')) ASC,
      (
        (NULLIF(BTRIM(m.product_type), '') IS NOT NULL)::int + (NULLIF(BTRIM(m.niche), '') IS NOT NULL)::int
        + (NULLIF(BTRIM(m.pic_mkt), '') IS NOT NULL)::int + (NULLIF(BTRIM(m.brand), '') IS NOT NULL)::int
        + (NULLIF(BTRIM(m.brand_entity_id), '') IS NOT NULL)::int + (NULLIF(BTRIM(m.creative_asins_video), '') IS NOT NULL)::int
        + (NULLIF(BTRIM(m.creative_asins_collection), '') IS NOT NULL)::int + (NULLIF(BTRIM(m.video_media_ids), '') IS NOT NULL)::int
        + (NULLIF(BTRIM(m.creative_headline), '') IS NOT NULL)::int + (NULLIF(BTRIM(m.brand_logo_asset_id), '') IS NOT NULL)::int
        + (NULLIF(BTRIM(m.landing_page_url), '') IS NOT NULL)::int
      ) DESC,
      m.updated_at DESC NULLS LAST
  `;
  const storeLogo = await getStoreLogos();
  return rows
    .map((r) => ({
      sku: r.sku,
      productType: r.product_type || "",
      niche: r.niche || "",
      picMkt: r.pic_mkt || "",
      brand: r.brand || "",
      // Entity chuẩn của store; Creative ASIN (Video, Collection) luôn là ASIN của chính SKU (khớp 100% Bảng mã FBM, 842/845 FBA)
      brandEntityId: storeEntities.get(storeKey(r.store_name)) || r.brand_entity_id || "",
      creativeAsinsVideo: r.asin || r.creative_asins_video || "",
      creativeAsinsCollection: r.asin || r.creative_asins_collection || "",
      videoMediaIds: r.video_media_ids || "",
      creativeHeadline: r.creative_headline || "",
      brandLogoAssetId: storeLogo.get(storeKey(r.store_name)) || (LOGO_PATTERN.test(r.brand_logo_asset_id || "") ? r.brand_logo_asset_id : "") || "",
      landingPageUrl: r.landing_page_url || "",
      storeName: r.store_name || "",
      asin: r.asin || "",
      status: r.status || "",
      mockupUrl: r.mockup_url || "",
    }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
}

export async function saveKwFile(teamId: string, userId: string, fileName: string, data: Buffer): Promise<number> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO ppc_new_camp_kw_files (team_id, file_name, file_data, created_by)
    VALUES (${teamId}, ${fileName}, ${data}, ${userId})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function searchKwFiles(teamId: string, query: string): Promise<Array<{ id: number; name: string; createdAt: string }>> {
  const sql = await getDatabaseClient();
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<{ id: string; file_name: string; created_at: Date }[]>`
    SELECT id, file_name, created_at
    FROM ppc_new_camp_kw_files
    WHERE team_id = ${teamId} AND file_name ILIKE ${pattern}
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return rows.map((r) => ({ id: Number(r.id), name: r.file_name, createdAt: new Date(r.created_at).toISOString() }));
}

export async function getKwFile(teamId: string, id: number): Promise<{ name: string; data: Buffer } | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ file_name: string; file_data: Buffer }[]>`
    SELECT file_name, file_data FROM ppc_new_camp_kw_files WHERE team_id = ${teamId} AND id = ${id} LIMIT 1
  `;
  return rows[0] ? { name: rows[0].file_name, data: Buffer.from(rows[0].file_data) } : null;
}

// ---------------------------------------------------------------------------
// Tên campaign đã có trên Amazon (chặn lên trùng)
// ---------------------------------------------------------------------------

export interface ExistingCampaign {
  name: string;
  store: string;
  state: string;
}

const EXISTING_TTL_MS = 15 * 60 * 1000;
const existingCache = new Map<string, { at: number; index: Map<string, ExistingCampaign> }>();

export function normalizeCampaignName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Tên campaign hiện có của team: snapshot đang dùng (coverage dài nhất) của từng store trong ppc_campaign_summary
 * + camp đã đẩy lên qua web 30 ngày gần đây (có thể chưa kịp vào báo cáo).
 * Quét ~80k dòng (~1-2 giây) nên giữ trong bộ nhớ 15 phút.
 */
async function existingCampaignIndex(teamId: string): Promise<Map<string, ExistingCampaign>> {
  const cached = existingCache.get(teamId);
  if (cached && Date.now() - cached.at < EXISTING_TTL_MS) return cached.index;
  const sql = await getDatabaseClient();
  const index = new Map<string, ExistingCampaign>();
  await sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '20s'`;
    const rows = await tx<{ campaign_name: string; store_name: string; campaign_state: string | null }[]>`
      WITH snap AS (
        SELECT DISTINCT ON (store_id) store_id, snapshot_id, coverage_days
        FROM ppc_active_snapshots
        WHERE team_id = ${teamId}
        ORDER BY store_id, coverage_days DESC
      )
      SELECT c.campaign_name, s.name AS store_name, c.campaign_state
      FROM snap
      JOIN ppc_campaign_summary c
        ON c.store_id = snap.store_id AND c.coverage_days = snap.coverage_days AND c.snapshot_id = snap.snapshot_id
      JOIN ppc_stores s ON s.id = c.store_id
    `;
    for (const r of rows) index.set(normalizeCampaignName(r.campaign_name), { name: r.campaign_name, store: r.store_name, state: (r.campaign_state || "").toLowerCase() });
    const uploaded = await tx<{ name: string; store_name: string; status: string }[]>`
      SELECT DISTINCT p->>'campaignName' AS name, s.name AS store_name, l.status
      FROM ppc_auto_upload_logs l
      JOIN ppc_stores s ON s.id = l.store_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.actions_payload) = 'array' THEN l.actions_payload ELSE '[]'::jsonb END) p
      WHERE l.team_id = ${teamId}
        AND l.created_at > NOW() - INTERVAL '30 days'
        AND l.status NOT IN ('FAILED')
        AND p->>'actionType' = 'CREATE_CAMPAIGN'
        AND COALESCE(p->>'campaignName', '') <> ''
    `;
    for (const r of uploaded) {
      const key = normalizeCampaignName(r.name);
      if (!index.has(key)) index.set(key, { name: r.name, store: r.store_name, state: `vừa upload (${r.status.toLowerCase()})` });
    }
  });
  existingCache.set(teamId, { at: Date.now(), index });
  return index;
}

/** Trả về các tên trong danh sách đã tồn tại (so không phân biệt hoa thường / dấu cách thừa). */
export async function findExistingCampaigns(teamId: string, names: string[]): Promise<Record<string, ExistingCampaign>> {
  if (names.length === 0) return {};
  const index = await existingCampaignIndex(teamId);
  const out: Record<string, ExistingCampaign> = {};
  for (const n of names) {
    const hit = index.get(normalizeCampaignName(n));
    if (hit) out[n] = hit;
  }
  return out;
}

/** Sau khi đẩy camp mới lên: thêm vào bộ nhớ để lần sau chặn ngay, không chờ hết 15 phút. */
export function rememberUploadedCampaigns(teamId: string, storeName: string, names: string[]) {
  const cached = existingCache.get(teamId);
  if (!cached) return;
  for (const n of names) cached.index.set(normalizeCampaignName(n), { name: n, store: storeName, state: "vừa upload" });
}
