import crypto from "node:crypto";
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";
import {
  LAUNCH_BIDDING_STRATEGIES,
  LAUNCH_MATCH_TYPES,
  LAUNCH_RUN_TYPES,
  buildLaunchPlan,
  countLaunchTargets,
  type LaunchOptions,
  type LaunchSkuOverride,
  type LaunchTerm,
} from "@/lib/ppc/campaign-launch";
import { exportCampaignLaunchBulksheet } from "@/lib/ppc/campaign-launch-bulksheet";
import { formatYYYYMMDD } from "@/lib/ppc/sku-extractor";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function exportTimestamp(date: Date): string {
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
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

function parseTerms(raw: unknown): LaunchTerm[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    term: String(t?.term || "").trim(),
    sku: String(t?.sku || "").trim().toUpperCase(),
    bid: Math.max(0.1, Number(t?.bid) || 1),
    clicks: Math.max(0, Number(t?.clicks) || 0),
    spend: Math.max(0, Number(t?.spend) || 0),
  })).filter((t) => t.term);
}

function parseMatchTypes(raw: unknown): LaunchOptions["matchTypes"] {
  const validMatch = new Set(LAUNCH_MATCH_TYPES.map((m) => m.key));
  return (Array.isArray(raw) ? raw : [])
    .map((m) => String(m).toLowerCase())
    .filter((m): m is LaunchOptions["matchTypes"][number] => validMatch.has(m as LaunchOptions["matchTypes"][number]));
}

function parseSkuOverrides(raw: unknown): Record<string, LaunchSkuOverride> {
  const overrides: Record<string, LaunchSkuOverride> = {};
  if (!raw || typeof raw !== "object") return overrides;
  for (const [key, value] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    const sku = key.trim().toUpperCase();
    if (!sku || !value || typeof value !== "object") continue;
    const o: LaunchSkuOverride = {};
    if (Array.isArray(value.matchTypes)) o.matchTypes = parseMatchTypes(value.matchTypes);
    if (Number(value.dailyBudget) > 0) o.dailyBudget = Number(value.dailyBudget);
    const strategy = LAUNCH_BIDDING_STRATEGIES.find((s) => s.value === value.biddingStrategy)?.value;
    if (strategy) o.biddingStrategy = strategy;
    if (typeof value.suffix === "string") o.suffix = value.suffix.trim();
    if (Number(value.commonBid) > 0) o.commonBid = Math.max(0.1, Number(value.commonBid));
    overrides[sku] = o;
  }
  return overrides;
}

function parseOptions(raw: Record<string, unknown> | undefined): LaunchOptions {
  const strategy = LAUNCH_BIDDING_STRATEGIES.find((s) => s.value === raw?.biddingStrategy)?.value || LAUNCH_BIDDING_STRATEGIES[0].value;
  return {
    runType: LAUNCH_RUN_TYPES.find((t) => t.value === raw?.runType)?.value || LAUNCH_RUN_TYPES[0].value,
    matchTypes: parseMatchTypes(raw?.matchTypes),
    dailyBudget: Number(raw?.dailyBudget) || 5,
    biddingStrategy: strategy,
    userName: String(raw?.userName || "").trim(),
    dateStr: String(raw?.dateStr || "").trim() || formatYYYYMMDD(),
    suffix: String(raw?.suffix || "").trim(),
    fulfillment: raw?.fulfillment === "FBM" ? "FBM" : "FBA",
    skuOverrides: parseSkuOverrides(raw?.skuOverrides),
    commonBid: Number(raw?.commonBid) > 0 ? Math.max(0.1, Number(raw?.commonBid)) : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === "upload" ? "upload" : "export";
    const actor = await authorize(request, mode === "upload" ? "write" : "export", "ppc");
    enforceRequestSize(request);
    const sql = await getDatabaseClient();

    const storeId = String(body?.storeId || "").trim();
    const storeNameInput = String(body?.storeName || "").trim();
    const storeRows = storeId
      ? await sql<{ id: string; name: string }[]>`SELECT id, name FROM ppc_stores WHERE id = ${storeId} AND team_id = ${actor.teamId} LIMIT 1`
      : await sql<{ id: string; name: string }[]>`SELECT id, name FROM ppc_stores WHERE LOWER(name) = LOWER(${storeNameInput}) AND team_id = ${actor.teamId} LIMIT 1`;
    const store = storeRows[0];
    if (!store) throw new ApiError("Vui lòng chọn 1 Store cụ thể để lên camp.", 400);

    const terms = parseTerms(body?.terms);
    const options = parseOptions(body?.options);
    if (terms.length === 0) throw new ApiError("Chưa có search term nào để lên camp.", 400);
    if (terms.some((t) => !t.sku || t.sku === "UNKNOWN_SKU")) throw new ApiError("Còn search term chưa có SKU.", 400);
    if (options.runType === "SP03" && options.matchTypes.length === 0) {
      throw new ApiError("Chọn ít nhất 1 match type.", 400);
    }

    const plan = buildLaunchPlan(terms, options);
    if (plan.campaigns.length === 0) throw new ApiError("Không có term nào phù hợp với dạng chạy đã chọn.", 400);

    const buffer = await exportCampaignLaunchBulksheet(plan);
    const targetCount = countLaunchTargets(plan);
    const cleanStore = store.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const fileName = `Upload_${cleanStore}_Launch_${plan.campaigns.length}Camps_${targetCount}Targets_${exportTimestamp(new Date())}.xlsx`;

    if (mode === "export") {
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_TYPE,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);
    if (objectStorageDriver() !== "r2") throw new Error("Auto Upload remote yêu cầu OBJECT_STORAGE_DRIVER=r2.");

    const jobId = crypto.randomUUID();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const r2Key = `${r2KeyPrefix()}/ppc-bulk-upload/${cleanStore}/${jobId}/${fileName}`;
    await putStoredObject({
      key: r2Key,
      bytes: buffer,
      contentType: XLSX_TYPE,
      sha256,
      metadata: { purpose: "amazon-ads-bulk-upload", store: cleanStore, job: jobId },
    });

    const actionsPayload = plan.campaigns.flatMap((camp) =>
      camp.adGroups.flatMap((group) => [
        ...group.keywords.map((kw) => ({ target: kw.text, matchType: kw.matchType, bid: kw.bid })),
        ...group.productTargets.map((pt) => ({ target: pt.expression, matchType: "product", bid: pt.bid })),
      ].map((target, idx) => ({
        id: `launch-${jobId.slice(0, 8)}-${camp.name}-${idx}`,
        sku: camp.sku,
        campaignName: camp.name,
        adGroupName: group.name,
        targetKeyword: target.target,
        matchType: target.matchType,
        actionType: "CREATE_CAMPAIGN",
        bid: target.bid,
        dailyBudget: camp.dailyBudget,
        status: "PENDING",
      }))),
    );
    const campaignNames = plan.campaigns.map((c) => c.name).slice(0, 50);

    await sql`
      INSERT INTO ppc_auto_upload_logs (
        id, team_id, store_id, file_name, action_count, skus, status, stage,
        file_status, progress_pct, action_ids, actions_payload, r2_key, sha256, updated_at, created_by
      ) VALUES (
        ${jobId}, ${actor.teamId}, ${store.id}, ${fileName}, ${targetCount},
        ${sql.json(campaignNames)}, 'PENDING', 'FILE_READY',
        'SUCCESS', 25, ${sql.json([])}, ${sql.json(actionsPayload)}, ${r2Key}, ${sha256}, NOW(), ${actor.userId}
      )
    `;

    return Response.json(
      { success: true, jobId, fileName, campaignCount: plan.campaigns.length, targetCount },
      { status: 202 },
    );
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lên camp.", 500);
  }
}
