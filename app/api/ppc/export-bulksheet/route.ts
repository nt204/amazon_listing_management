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
  const campaignNames = Array.from(new Set(
    recommendations.map((recommendation) => recommendation.campaignName?.trim()).filter(Boolean),
  )) as string[];
  const campaignLabel = campaignNames.length > 1
    ? `Multi Campaigns (${campaignNames.length})`
    : campaignNames[0] || "Unknown Campaign";
  const safeCampaignLabel = campaignLabel
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Unknown Campaign";
  return `Update - ${safeCampaignLabel} - ${exportTimestamp(date)}.xlsx`;
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
