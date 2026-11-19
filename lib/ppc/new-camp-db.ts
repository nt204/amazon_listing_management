// Lên camp SKU mới — dữ liệu: thông tin SKU từ BẢNG MÃ (thay Google Sheets của tool cũ)
// và kho file keyword (thay SQLite kw_files).
import { getDatabaseClient } from "@/lib/db";
import type { NewCampSkuInfo } from "./new-camp-generator";

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
};

/**
 * Danh sách SKU theo loại hình: FBA = BẢNG MÃ (accounting_sku_master), FBM = BẢNG MÃ FBM.
 * SKU trùng (nhiều store / nhiều ASIN) lấy dòng điền đủ thông tin nhất, như tool cũ gộp các sheet.
 */
export async function listNewCampSkus(loaiHinh: "FBA" | "FBM"): Promise<NewCampSkuInfo[]> {
  const sql = await getDatabaseClient();
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
      COALESCE(NULLIF(BTRIM(m.mockup_url), ''), NULLIF(BTRIM(m.mockup), '')) AS mockup_url
    FROM ${table} m
    LEFT JOIN stores s ON s.id = m.store_id
    WHERE m.deleted_at IS NULL AND BTRIM(COALESCE(m.sku, '')) <> ''
    ORDER BY
      UPPER(BTRIM(m.sku)),
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
  return rows
    .map((r) => ({
      sku: r.sku,
      productType: r.product_type || "",
      niche: r.niche || "",
      picMkt: r.pic_mkt || "",
      brand: r.brand || "",
      brandEntityId: r.brand_entity_id || "",
      creativeAsinsVideo: r.creative_asins_video || "",
      creativeAsinsCollection: r.creative_asins_collection || "",
      videoMediaIds: r.video_media_ids || "",
      creativeHeadline: r.creative_headline || "",
      brandLogoAssetId: r.brand_logo_asset_id || "",
      landingPageUrl: r.landing_page_url || "",
      storeName: r.store_name || "",
      asin: r.asin || "",
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
