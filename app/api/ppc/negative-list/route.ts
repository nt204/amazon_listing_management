// Negative List: user dán 1 list keyword → phủ định (Campaign Negative Keyword) cho toàn bộ campaign của ASIN đã chọn.
// GET  ?storeName=&q=      → gợi ý ASIN/SKU có campaign trong store (kèm SKU, ảnh mockup)
// GET  ?storeName=&asins=  → danh sách campaign đang quảng cáo các ASIN
// POST { storeName, asins, campaignIds, keywords, matchType, mode? } → tạo bulksheet:
//   mode = "export" → trả file về trình duyệt + tạo lô 'exported' (chờ tick "Đã upload"); mặc định → xếp hàng Auto Upload
// Lô chờ xác nhận / đang Auto Upload: xem ./batches/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import {
  exportTimestamp,
  queueNegativeAutoUpload,
  registerNegatives,
  type NegativeListRecommendation,
} from "@/lib/ppc/negative-list-upload";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";
import { loadAsinCampaigns, normalizeAsins, searchAsins } from "@/lib/ppc/asin-campaigns";
import type { PpcRecommendation } from "@/lib/ppc/types";
import crypto from "node:crypto";
import JSZip from "jszip";

export const runtime = "nodejs";

const MAX_KEYWORDS = 1000;
const MAX_ASINS = 50;
// 1 ASIN có thể chạy vài trăm campaign (kể cả SB) → 330 campaign × 311 keyword ≈ 100k dòng.
// Chia thành nhiều file, mỗi file tối đa ROWS_PER_FILE dòng (không cắt đôi 1 campaign): Auto Upload = mỗi file 1 job,
// Xuất File = nhiều file thì nén zip.
const ROWS_PER_FILE = 30000;
const MAX_ROWS = 300000;
const HEADER_WORDS = new Set(["negative phrase kw", "negative exact kw", "negative kw", "keyword", "keywords"]);

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

async function resolveStore(sql: Sql, teamId: string, storeName: string) {
  if (!storeName || storeName === "ALL") {
    throw new ApiError("Vui lòng chọn 1 Store cụ thể trước khi phủ định.", 400);
  }
  const [row] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores
    WHERE LOWER(name) = LOWER(${storeName}) AND team_id = ${teamId}
    LIMIT 1
  `;
  if (!row) throw new ApiError(`Không tìm thấy Store "${storeName}".`, 404);
  return row;
}

function normalizeKeywords(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input || "").split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw) {
    const kw = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (!kw || kw.length > 80 || HEADER_WORDS.has(kw) || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "").trim();
    const query = searchParams.get("q");
    if (query !== null) {
      if (query.length > 60) throw new ApiError("Từ khoá tìm quá dài.", 400);
      const sql = await getDatabaseClient();
      const store = await resolveStore(sql, actor.teamId, storeName);
      const items = await searchAsins(sql, { storeId: store.id, storeName: store.name, query });
      return Response.json({ success: true, items });
    }
    const asins = normalizeAsins(searchParams.get("asins"));
    if (asins.length === 0) throw new ApiError("Nhập ít nhất 1 ASIN hợp lệ (10 ký tự, VD: B0XXXXXXXX).", 400);
    if (asins.length > MAX_ASINS) throw new ApiError(`Tối đa ${MAX_ASINS} ASIN mỗi lần.`, 400);

    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, storeName);
    const { campaigns, snapshot } = await loadAsinCampaigns(sql, { storeId: store.id, asins });
    const foundAsins = new Set(campaigns.map((c) => c.asin));
    return Response.json({
      success: true,
      storeName: store.name,
      asins,
      missingAsins: asins.filter((a) => !foundAsins.has(a)),
      snapshot,
      campaigns,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được campaign của ASIN.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);
    const body = await request.json().catch(() => ({}));

    const asins = normalizeAsins(body?.asins);
    const keywords = normalizeKeywords(body?.keywords);
    const matchType = body?.matchType === "negativeExact" ? "negativeExact" : "negativePhrase";
    const wantedCampaignIds = new Set<string>(Array.isArray(body?.campaignIds) ? body.campaignIds.map(String) : []);

    if (asins.length === 0) throw new ApiError("Chưa chọn ASIN.", 400);
    if (asins.length > MAX_ASINS) throw new ApiError(`Tối đa ${MAX_ASINS} ASIN mỗi lần.`, 400);
    if (keywords.length === 0) throw new ApiError("Danh sách keyword trống.", 400);
    if (keywords.length > MAX_KEYWORDS) throw new ApiError(`Tối đa ${MAX_KEYWORDS} keyword mỗi lần.`, 400);
    if (wantedCampaignIds.size === 0) throw new ApiError("Chưa chọn campaign nào.", 400);

    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, String(body?.storeName || "").trim());
    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);

    // Chỉ nhận campaign thật sự thuộc ASIN (không tin campaignId từ client)
    const { campaigns: asinCampaigns } = await loadAsinCampaigns(sql, { storeId: store.id, asins });
    // SD không có Negative Keyword → bỏ qua
    const campaigns = asinCampaigns.filter((c) => c.campaignId && c.adType !== "SD" && wantedCampaignIds.has(c.campaignId));
    if (campaigns.length === 0) throw new ApiError("Không có campaign hợp lệ của ASIN đã chọn.", 400);

    // Bỏ cặp (campaign, keyword, match type) đã phủ định (enabled) hoặc đang Auto Upload (pending).
    // Lô chỉ mới xuất file ('exported') chưa chắc đã lên Amazon → không chặn.
    const existing = await sql<{ campaign_name: string; keyword_text: string }[]>`
      SELECT campaign_name, keyword_text FROM ppc_negative_registry
      WHERE store_id = ${store.id}
        AND match_type = ${matchType}
        AND state IN ('enabled', 'pending')
        AND campaign_name = ANY(${campaigns.map((c) => c.campaignName)})
        AND lower(trim(keyword_text)) = ANY(${keywords})
    `;
    const existingKeys = new Set(existing.map((r) => `${r.campaign_name}|||${r.keyword_text.trim().toLowerCase()}`));

    const now = new Date().toISOString();
    const amazonMatch = matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact";
    const recommendations: NegativeListRecommendation[] = [];
    let skipped = 0;
    for (const c of campaigns) {
      for (const kw of keywords) {
        if (existingKeys.has(`${c.campaignName}|||${kw}`)) {
          skipped++;
          continue;
        }
        recommendations.push({
          id: `neg-list-${recommendations.length}-${Date.now()}`,
          storeId: store.id,
          storeName: store.name,
          adType: (c.adType as PpcRecommendation["adType"]) || "SP",
          recType: "NEGATIVE_KEYWORD",
          targetType: "EXACT",
          keyword: kw,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          matchType: "Exact",
          priority: "P1",
          reason: `Negative List (${amazonMatch}) cho ASIN ${c.asin}.`,
          estimatedSavings: 0,
          status: "PENDING",
          createdAt: now,
          // Campaign Negative Keyword (SP) → chặn keyword trên toàn bộ campaign
          level: "CAMPAIGN",
          negativeMatchType: matchType,
        });
      }
    }

    if (recommendations.length === 0) {
      throw new ApiError(`Tất cả ${skipped} cặp keyword × campaign đã được phủ định trước đó.`, 400);
    }
    if (recommendations.length > MAX_ROWS) {
      throw new ApiError(
        `Quá nhiều dòng (${recommendations.length}). Tối đa ${MAX_ROWS} dòng / lần — hãy chia nhỏ ASIN hoặc keyword.`,
        400,
      );
    }

    // Chia file theo campaign (recommendations đã xếp liền theo campaign)
    const parts: NegativeListRecommendation[][] = [];
    {
      let current: NegativeListRecommendation[] = [];
      let i = 0;
      while (i < recommendations.length) {
        const camp = recommendations[i].campaignName;
        let j = i;
        while (j < recommendations.length && recommendations[j].campaignName === camp) j++;
        const group = recommendations.slice(i, j);
        if (current.length > 0 && current.length + group.length > ROWS_PER_FILE) {
          parts.push(current);
          current = [];
        }
        current.push(...group);
        i = j;
      }
      if (current.length > 0) parts.push(current);
    }

    const cleanStore = store.name.replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
    const tag = matchType === "negativePhrase" ? "NegativePhrase" : "NegativeExact";
    const stamp = exportTimestamp(new Date());
    const files: Array<{ fileName: string; recs: NegativeListRecommendation[]; buffer: Buffer; keywordCount: number; campaignCount: number }> = [];
    for (let idx = 0; idx < parts.length; idx++) {
      const recs = parts[idx];
      const keywordCount = new Set(recs.map((r) => r.keyword)).size;
      const campaignCount = new Set(recs.map((r) => r.campaignName)).size;
      const partTag = parts.length > 1 ? `_Part${idx + 1}of${parts.length}` : "";
      const fileName = `Upload_${cleanStore}_NegList_${tag}_${keywordCount}KW_${campaignCount}Camp_${stamp}${partTag}.xlsx`;
      const buffer = await exportBulksheetUpdateExcel(recs);
      files.push({ fileName, recs, buffer, keywordCount, campaignCount });
    }

    // Xuất file: tải về để tự upload lên Amazon. Mỗi file = 1 lô 'exported' — chỉ sang Negative Hub khi người dùng
    // tick "Đã upload" (hoặc bấm Auto Upload lô đó).
    if (body?.mode === "export") {
      for (const f of files) {
        const batchId = crypto.randomUUID();
        await sql`
          INSERT INTO ppc_negative_batches (
            id, team_id, store_id, store_name, source, file_name, match_type, asins,
            keyword_count, campaign_count, row_count, status, created_by, created_at
          ) VALUES (
            ${batchId}, ${actor.teamId}, ${store.id}, ${store.name}, 'NEGATIVE_LIST', ${f.fileName}, ${matchType},
            ${sql.json(asins)}, ${f.keywordCount}, ${f.campaignCount}, ${f.recs.length}, 'EXPORTED', ${actor.userId}, NOW()
          )
        `;
        await registerNegatives(sql, { teamId: actor.teamId, store, recommendations: f.recs, matchType, state: "exported", jobId: batchId });
      }

      let outBytes: Uint8Array;
      let outName: string;
      let contentType: string;
      if (files.length === 1) {
        outBytes = new Uint8Array(files[0].buffer);
        outName = files[0].fileName;
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else {
        const zip = new JSZip();
        for (const f of files) zip.file(f.fileName, f.buffer);
        outBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
        outName = `Upload_${cleanStore}_NegList_${tag}_${recommendations.length}rows_${files.length}files_${stamp}.zip`;
        contentType = "application/zip";
      }
      const asciiFileName = outName.replace(/[^A-Za-z0-9 ._+()-]+/g, "").trim() || "Negative_List.xlsx";
      return new Response(Buffer.from(outBytes), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(outName)}`,
          "Cache-Control": "no-store",
          "X-Action-Count": String(recommendations.length),
          "X-Skipped-Count": String(skipped),
          "X-File-Count": String(files.length),
        },
      });
    }

    // Auto Upload: mỗi file 1 job trên Mac mini
    const jobs: Array<{ jobId: string; fileName: string; actionCount: number }> = [];
    for (const f of files) {
      const { jobId } = await queueNegativeAutoUpload(sql, {
        teamId: actor.teamId,
        userId: actor.userId,
        store,
        recommendations: f.recs,
        matchType,
        asins,
        buffer: f.buffer,
        fileName: f.fileName,
      });
      jobs.push({ jobId, fileName: f.fileName, actionCount: f.recs.length });
    }

    return Response.json(
      {
        success: true,
        jobId: jobs[0].jobId,
        jobs,
        fileName: jobs.map((j) => j.fileName).join(", "),
        actionCount: recommendations.length,
        skipped,
        keywordCount: keywords.length,
        campaignCount: campaigns.length,
        storeName: store.name,
        message:
          `Đã xếp hàng upload trên Mac mini: ${keywords.length} keyword × ${campaigns.length} campaign = ` +
          `${recommendations.length.toLocaleString("en-US")} dòng ${amazonMatch}` +
          (jobs.length > 1 ? `, chia ${jobs.length} file (tối đa ${ROWS_PER_FILE.toLocaleString("en-US")} dòng/file).` : "."),
      },
      { status: 202 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xếp hàng Negative List.", 500);
  }
}
