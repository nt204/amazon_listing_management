import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { exportBulksheetUpdateExcel } from "@/lib/ppc/service";
import type { PpcRecommendation } from "@/lib/ppc/types";

export const runtime = "nodejs";

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
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

function exportFileName(recommendations: PpcRecommendation[], date = new Date()): string {
  const storeName = (recommendations[0]?.storeName || "STORE")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .replace(/\s+/g, "_");

  const adTypes = Array.from(new Set(recommendations.map((r) => (r.adType || "SP").toUpperCase())));
  const adTypeLabel = adTypes.length === 1 ? adTypes[0] : "MIXED";

  const campaignNames = Array.from(new Set(
    recommendations.map((r) => r.campaignName?.trim()).filter(Boolean),
  )) as string[];
  const distinctSkus = Array.from(new Set(
    recommendations.map((r) => r.sku?.trim()).filter(Boolean),
  )) as string[];

  let scopeLabel: string;
  if (campaignNames.length === 1) {
    scopeLabel = campaignNames[0]
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 35)
      .replace(/_+$/, "");
  } else if (distinctSkus.length === 1) {
    scopeLabel = `SKU_${distinctSkus[0].replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 20)}`;
  } else {
    scopeLabel = `${campaignNames.length}Camps`;
  }

  const recTypes = new Set(recommendations.map((r) => r.recType));
  let actionLabel = `${recommendations.length}Actions`;
  if (recTypes.size === 1) {
    const only: string = Array.from(recTypes)[0];
    if (only === "BID_DECREASE" || only === "BID_INCREASE") actionLabel = "BidUpdate";
    else if (only === "PAUSE_TARGET") actionLabel = "Pause";
    else if (only === "NEGATIVE_KEYWORD") actionLabel = "Negative";
    else if (only === "HARVEST_KEYWORD") actionLabel = "Harvest";
    else if (only === "UPDATE_BUDGET") actionLabel = "Budget";
  }

  return `Upload_${storeName}_${adTypeLabel}_${scopeLabel}_${actionLabel}_${exportTimestamp(date)}.xlsx`;
}

function contentDisposition(fileName: string): string {
  const asciiFileName = fileName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ._+()-]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "Update.xlsx";
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function POST(request: Request) {
  try {
    authorize(request, "export");
    enforceRequestSize(request);

    const body = await request.json();
    const recommendations: PpcRecommendation[] = Array.isArray(body?.recommendations)
      ? body.recommendations
      : [];

    if (recommendations.length === 0) {
      return Response.json({ error: "Không có đề xuất nào được chọn để xuất file." }, { status: 400 });
    }
    if (recommendations.some((recommendation) => recommendation.adType !== "SP")) {
      throw new ApiError("Exporter hiện chỉ hỗ trợ action Sponsored Products đã được Bulk SP xác minh.", 400);
    }
    const incomplete = recommendations.find((recommendation) =>
      !recommendation.campaignId || !recommendation.adGroupId ||
      ((recommendation.recType === "BID_DECREASE" || recommendation.recType === "BID_INCREASE") && !recommendation.keywordId),
    );
    if (incomplete) {
      throw new ApiError(`Đề xuất "${incomplete.keyword}" thiếu Amazon ID để thực thi an toàn.`, 400);
    }
    const missingMatchType = recommendations.find((recommendation) =>
      recommendation.targetType !== "PRODUCT" &&
      (recommendation.recType === "BID_DECREASE" || recommendation.recType === "BID_INCREASE" || recommendation.recType === "PAUSE_TARGET") &&
      recommendation.matchType !== "Exact" && recommendation.matchType !== "Phrase" && recommendation.matchType !== "Broad",
    );
    if (missingMatchType) {
      throw new ApiError(`Target "${missingMatchType.keyword}" thiếu Match Type nguồn. Hãy tải lại dashboard trước khi xuất.`, 400);
    }

    const buffer = await exportBulksheetUpdateExcel(recommendations);
    const fileName = exportFileName(recommendations);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất file Bulksheet Update.", 500);
  }
}
