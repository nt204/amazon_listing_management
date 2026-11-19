import "server-only";

// Negative List: ghi Negative Hub (ppc_negative_registry) và xếp hàng Auto Upload lên Mac mini.
// Dùng chung cho POST /api/ppc/negative-list và nút "Auto Upload" của lô đã xuất file (./batches).
import crypto from "node:crypto";
import type { getDatabaseClient } from "@/lib/db";
import { invalidateCachePattern } from "@/lib/redis";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import type { PpcRecommendation } from "@/lib/ppc/types";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

export type NegativeListRecommendation = PpcRecommendation & { level: string; negativeMatchType: string };

export async function registerNegatives(
  sql: Sql,
  p: {
    teamId: string;
    store: { id: string; name: string };
    recommendations: PpcRecommendation[];
    matchType: string;
    state: "pending" | "exported";
    jobId: string | null;
  },
) {
  try {
    const rows = p.recommendations.map((rec) => ({
      ad_type: rec.adType || "SP",
      campaign_id: rec.campaignId || null,
      campaign_name: rec.campaignName,
      ad_group_id: rec.adGroupId || null,
      ad_group_name: rec.adGroupName || null,
      keyword_text: rec.keyword,
      reason: rec.reason,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await sql`
        INSERT INTO ppc_negative_registry (
          team_id, store_id, store_name, ad_type, campaign_id, campaign_name,
          ad_group_id, ad_group_name, keyword_text, match_type, level,
          state, source, source_job_id, clicks, spend, reason, created_at, updated_at
        )
        SELECT ${p.teamId}, ${p.store.id}, ${p.store.name}, x.ad_type, x.campaign_id, x.campaign_name,
               x.ad_group_id, x.ad_group_name, x.keyword_text, ${p.matchType}, 'CAMPAIGN',
               ${p.state}, 'NEGATIVE_LIST', ${p.jobId}, 0, 0, x.reason, NOW(), NOW()
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::text::jsonb) AS x(
          ad_type text, campaign_id text, campaign_name text, ad_group_id text,
          ad_group_name text, keyword_text text, reason text
        )
        ON CONFLICT (store_id, campaign_name, keyword_text, match_type) DO UPDATE SET
          updated_at = NOW(),
          source = EXCLUDED.source,
          -- Đã bật trên Amazon thì giữ: job mới lỗi sẽ xoá theo source_job_id, không được xoá mất phủ định đang chạy.
          -- Đang Auto Upload (pending) mà chỉ xuất file thì cũng giữ nguyên job đang chạy.
          state = CASE
            WHEN ppc_negative_registry.state = 'enabled' THEN 'enabled'
            WHEN ppc_negative_registry.state = 'pending' AND EXCLUDED.state = 'exported' THEN 'pending'
            ELSE EXCLUDED.state END,
          source_job_id = CASE
            WHEN ppc_negative_registry.state = 'enabled' THEN ppc_negative_registry.source_job_id
            WHEN ppc_negative_registry.state = 'pending' AND EXCLUDED.state = 'exported' THEN ppc_negative_registry.source_job_id
            ELSE EXCLUDED.source_job_id END,
          reason = EXCLUDED.reason
      `;
    }
    await invalidateCachePattern(`ppc:query:st-opt:${p.teamId}:*`).catch(() => {});
  } catch (registryErr) {
    console.error("Lỗi khi ghi Negative List vào ppc_negative_registry:", registryErr);
  }
}

export function exportTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

/** Đưa file Bulk lên R2, tạo job ppc_auto_upload_logs và ghi các cặp vào registry ở trạng thái 'pending'. */
export async function queueNegativeAutoUpload(
  sql: Sql,
  p: {
    teamId: string;
    userId: string;
    store: { id: string; name: string };
    recommendations: NegativeListRecommendation[];
    matchType: string;
    asins: string[];
    buffer: Buffer;
    fileName: string;
  },
) {
  if (objectStorageDriver() !== "r2") {
    throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");
  }
  const amazonMatch = p.matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact";
  const jobId = crypto.randomUUID();
  const sha256 = crypto.createHash("sha256").update(p.buffer).digest("hex");
  const safeStore = p.store.name.replace(/[^A-Za-z0-9._-]+/g, "-");
  const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${safeStore}/${jobId}/${p.fileName}`;

  await putStoredObject({
    key: r2Key,
    bytes: p.buffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sha256,
    metadata: { purpose: "amazon-ads-bulk-upload", store: safeStore, job: jobId },
  });

  const actionsPayload = p.recommendations.map((rec) => ({
    id: rec.id,
    sku: "NEGATIVE_LIST",
    campaignName: rec.campaignName,
    adGroupName: rec.adGroupName || "",
    targetKeyword: rec.keyword,
    matchType: amazonMatch,
    actionType: "NEGATIVE_KEYWORD",
    oldValue: null,
    finalValue: null,
    status: "PENDING",
  }));

  await sql`
    INSERT INTO ppc_auto_upload_logs (
      id, team_id, store_id, file_name, action_count, skus, status, stage,
      file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
    ) VALUES (
      ${jobId}, ${p.teamId}, ${p.store.id}, ${p.fileName}, ${p.recommendations.length},
      ${sql.json(p.asins)}, 'PENDING', 'FILE_READY',
      'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), ${p.userId}
    )
  `;

  // Ghi Negative Hub (pending → worker chuyển enabled khi upload xong, xoá nếu lỗi)
  await registerNegatives(sql, {
    teamId: p.teamId,
    store: p.store,
    recommendations: p.recommendations,
    matchType: p.matchType,
    state: "pending",
    jobId,
  });
  return { jobId };
}
