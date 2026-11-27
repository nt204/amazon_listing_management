// app/api/ppc/targets/negative/route.ts
// Tab Target → "Phủ định": phủ định chính keyword / ASIN của target, chỉ trong đúng campaign chứa target đó.
// Dùng chung đường ống của Negative List: file bulksheet → tải về (lô 'exported') hoặc Auto Upload Mac mini (lô 'pending'),
// lô hiện ở tab Negative List và sang Negative Hub khi lên Amazon.
import crypto from "node:crypto";
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
import type { PpcRecommendation } from "@/lib/ppc/types";
import { targetNegativeKind } from "@/lib/ppc/target-negative";

export const runtime = "nodejs";

const MAX_ITEMS = 2000;

type Item = { campaignId: string; adGroupId: string; keyword: string };

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);
    const body = await request.json().catch(() => ({}));

    const storeName = String(body?.storeName || "").trim();
    if (!storeName || storeName === "ALL") throw new ApiError("Chọn 1 store trước khi phủ định.", 400);
    const matchType = body?.matchType === "negativePhrase" ? "negativePhrase" : "negativeExact";
    const mode = body?.mode === "export" ? "export" : "upload";
    const rawItems: Item[] = (Array.isArray(body?.items) ? body.items : [])
      .map((x: Record<string, unknown>) => ({
        campaignId: String(x?.campaignId || "").trim(),
        adGroupId: String(x?.adGroupId || "").trim(),
        keyword: String(x?.keyword || "").trim(),
      }))
      .filter((x: Item) => x.campaignId && x.keyword);
    if (rawItems.length === 0) throw new ApiError("Chưa chọn target nào.", 400);
    if (rawItems.length > MAX_ITEMS) throw new ApiError(`Tối đa ${MAX_ITEMS} target mỗi lần.`, 400);

    const sql = await getDatabaseClient();
    const [store] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM ppc_stores WHERE team_id = ${actor.teamId} AND lower(name) = lower(${storeName}) LIMIT 1
    `;
    if (!store) throw new ApiError(`Không tìm thấy store "${storeName}".`, 404);
    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);

    // Tên campaign / ad group / loại quảng cáo lấy từ dữ liệu của store (không tin tên client gửi).
    const campaignIds = Array.from(new Set(rawItems.map((x) => x.campaignId)));
    const known = await sql<Array<{ campaign_id: string; campaign_name: string; ad_group_id: string; ad_group_name: string; ad_type: string }>>`
      SELECT DISTINCT ON (campaign_id, ad_group_id) campaign_id, campaign_name, ad_group_id, ad_group_name, ad_type
      FROM ppc_performance_facts
      WHERE store_id = ${store.id}
        AND campaign_id = ANY(${campaignIds})
        AND ad_group_id IS NOT NULL AND campaign_name IS NOT NULL
      ORDER BY campaign_id, ad_group_id, snapshot_date DESC
    `;
    const byGroup = new Map(known.map((r) => [`${r.campaign_id}|${r.ad_group_id}`, r]));

    const now = new Date().toISOString();
    const amazonMatch = matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact";
    const seen = new Set<string>();
    const candidates: NegativeListRecommendation[] = [];
    let skipped = 0;
    for (const it of rawItems) {
      const g = byGroup.get(`${it.campaignId}|${it.adGroupId}`);
      const adType = (g?.ad_type || "SP").toUpperCase();
      const kind = targetNegativeKind(it.keyword, adType);
      if (!g || !kind) {
        skipped++;
        continue;
      }
      // ASIN chỉ có Negative Product Targeting (không có phrase) → luôn exact
      const neg = kind === "asin" ? "negativeExact" : matchType;
      const key = `${g.campaign_name}|||${it.keyword.toLowerCase()}|||${neg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: `target-neg-${candidates.length}-${Date.now()}`,
        storeId: store.id,
        storeName: store.name,
        adType: adType as PpcRecommendation["adType"],
        recType: "NEGATIVE_KEYWORD",
        targetType: kind === "asin" ? "PRODUCT" : "EXACT",
        keyword: it.keyword,
        campaignName: g.campaign_name,
        adGroupName: g.ad_group_name,
        campaignId: g.campaign_id,
        adGroupId: g.ad_group_id,
        matchType: "Exact",
        priority: "P1",
        reason: `Phủ định từ tab Target (${kind === "asin" ? "Negative Product Targeting" : amazonMatch}).`,
        estimatedSavings: 0,
        status: "PENDING",
        createdAt: now,
        // Keyword SP: Campaign Negative Keyword → chặn trên cả campaign. ASIN: Negative Product Targeting ở ad group
        // của chính target (chắc chắn hợp lệ). SB luôn ở ad group (Amazon không có campaign negative cho SB).
        level: kind === "asin" ? "AD_GROUP" : "CAMPAIGN",
        negativeMatchType: neg,
      });
    }

    // Bỏ cặp đã phủ định (enabled) hoặc đang Auto Upload (pending)
    const existing = candidates.length
      ? await sql<{ campaign_name: string; keyword_text: string; match_type: string }[]>`
          SELECT campaign_name, keyword_text, match_type FROM ppc_negative_registry
          WHERE store_id = ${store.id}
            AND state IN ('enabled', 'pending')
            AND campaign_name = ANY(${Array.from(new Set(candidates.map((c) => c.campaignName || "")))})
        `
      : [];
    const existingKeys = new Set(existing.map((r) => `${r.campaign_name}|||${r.keyword_text.trim().toLowerCase()}|||${r.match_type}`));
    const recommendations = candidates.filter((c) => {
      const dup = existingKeys.has(`${c.campaignName}|||${c.keyword.toLowerCase()}|||${c.negativeMatchType}`);
      if (dup) skipped++;
      return !dup;
    });
    if (recommendations.length === 0) {
      throw new ApiError(`Không có target nào phủ định được (đã phủ định trước đó, camp Auto/SD, hoặc không rõ campaign).`, 400);
    }

    // Registry ghi theo 1 match type / lần gọi: tách ASIN (luôn exact) khỏi keyword
    const groups = new Map<string, NegativeListRecommendation[]>();
    for (const r of recommendations) {
      const list = groups.get(r.negativeMatchType) || [];
      list.push(r);
      groups.set(r.negativeMatchType, list);
    }

    const cleanStore = store.name.replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
    const stamp = exportTimestamp(new Date());
    const files: Array<{ fileName: string; recs: NegativeListRecommendation[]; buffer: Buffer; neg: string }> = [];
    for (const [neg, recs] of groups) {
      const tag = neg === "negativePhrase" ? "NegativePhrase" : "NegativeExact";
      const campaignCount = new Set(recs.map((r) => r.campaignName)).size;
      const fileName = `Upload_${cleanStore}_TargetNeg_${tag}_${recs.length}rows_${campaignCount}Camp_${stamp}.xlsx`;
      files.push({ fileName, recs, neg, buffer: await exportBulksheetUpdateExcel(recs) });
    }

    if (mode === "export") {
      for (const f of files) {
        const batchId = crypto.randomUUID();
        await sql`
          INSERT INTO ppc_negative_batches (
            id, team_id, store_id, store_name, source, file_name, match_type, asins,
            keyword_count, campaign_count, row_count, status, created_by, created_at
          ) VALUES (
            ${batchId}, ${actor.teamId}, ${store.id}, ${store.name}, 'NEGATIVE_LIST', ${f.fileName}, ${f.neg},
            ${sql.json([])}, ${new Set(f.recs.map((r) => r.keyword.toLowerCase())).size},
            ${new Set(f.recs.map((r) => r.campaignName)).size}, ${f.recs.length}, 'EXPORTED', ${actor.userId}, NOW()
          )
        `;
        await registerNegatives(sql, { teamId: actor.teamId, store, recommendations: f.recs, matchType: f.neg, state: "exported", jobId: batchId });
      }
      // Thường chỉ 1 file; có cả ASIN lẫn keyword thì gộp 2 sheet vào 1 file không được → trả file đầu, báo số file
      const f = files[0];
      const asciiName = f.fileName.replace(/[^A-Za-z0-9 ._+()-]+/g, "") || "Target_Negative.xlsx";
      if (files.length > 1) {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (const x of files) zip.file(x.fileName, x.buffer);
        const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
        const zipName = `Upload_${cleanStore}_TargetNeg_${stamp}.zip`;
        return new Response(Buffer.from(bytes), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${zipName}"`,
            "Cache-Control": "no-store",
            "X-Action-Count": String(recommendations.length),
            "X-Skipped-Count": String(skipped),
          },
        });
      }
      return new Response(new Uint8Array(f.buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
          "Cache-Control": "no-store",
          "X-Action-Count": String(recommendations.length),
          "X-Skipped-Count": String(skipped),
        },
      });
    }

    const jobs: Array<{ jobId: string; fileName: string }> = [];
    for (const f of files) {
      const { jobId } = await queueNegativeAutoUpload(sql, {
        teamId: actor.teamId,
        userId: actor.userId,
        store,
        recommendations: f.recs,
        matchType: f.neg,
        asins: [],
        buffer: f.buffer,
        fileName: f.fileName,
      });
      jobs.push({ jobId, fileName: f.fileName });
    }
    return Response.json(
      {
        success: true,
        jobs,
        actionCount: recommendations.length,
        skipped,
        message: `Đã xếp hàng Auto Upload ${recommendations.length} phủ định${skipped ? `, bỏ qua ${skipped}` : ""}. Theo dõi ở tab Negative List.`,
      },
      { status: 202 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi phủ định target.", 500);
  }
}
