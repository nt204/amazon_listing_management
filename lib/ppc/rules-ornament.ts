import type { PpcPerformanceRow, PpcRecommendation, RecommendationType } from "./types";

/**
 * THÔNG SỐ KINH TẾ DÒNG GLASS ORNAMENT
 */
export const ORNAMENT_ECONOMICS = {
  productType: "Glass Ornament",
  baseCost: 2.0,
  amzFee: 6.32,
  retailPrice: 15.99,
  profitBeforeAds: 7.67,
  breakevenAcos: 48.0, // 7.67 / 15.99 = 47.96%
} as const;

export type OrnamentCampaignType = "SP03" | "SB01" | "SB05";

export interface OrnamentBidLimit {
  minBid: number;
  maxBid: number;
}

export const ORNAMENT_BID_LIMITS: Record<OrnamentCampaignType, OrnamentBidLimit> = {
  SP03: { minBid: 0.6, maxBid: 1.81 },
  SB01: { minBid: 0.1, maxBid: 1.51 },
  SB05: { minBid: 0.25, maxBid: 1.51 },
};

/**
 * Nhận diện Target / Campaign có thuộc dòng Glass Ornament hay không
 * (SKU bắt đầu bằng GO/GODL/GOL, hoặc Campaign/Portfolio có chứa GO hay Ornament)
 */
export function isGlassOrnamentTarget(row: {
  sku?: string;
  campaignName?: string;
  portfolioName?: string;
}): boolean {
  const sku = (row.sku || "").trim().toUpperCase();
  const camp = (row.campaignName || "").trim().toUpperCase();
  const port = (row.portfolioName || "").trim().toUpperCase();

  // Kiểm tra SKU tiền tố GO (GODL, GOL, GO...)
  if (/^GO[A-Z0-9]/.test(sku) || /\bGO\b/.test(sku)) return true;

  // Kiểm tra tên Campaign bắt đầu bằng mã SKU GO
  if (/^GO[A-Z0-9]/.test(camp) || /\bGLASS ORNAMENT\b/.test(camp)) return true;

  // Kiểm tra tên Portfolio hoặc Campaign chứa Ornament
  if (port.includes("ORNAMENT") || camp.includes("ORNAMENT")) return true;

  return false;
}

/**
 * Bóc tách định dạng chiến dịch từ tên campaign (SP03, SB01, SB05)
 */
export function detectOrnamentCampaignType(
  campaignName?: string,
  adType?: string,
): OrnamentCampaignType {
  const name = (campaignName || "").toUpperCase();
  if (/\bSP03\b/.test(name) || /SP03/.test(name)) return "SP03";
  if (/\bSB05\b/.test(name) || /SB05/.test(name)) return "SB05";
  if (/\bSB01\b/.test(name) || /SB01/.test(name)) return "SB01";
  if (/\bVIDEO\b/.test(name)) return "SB05";

  // Fallback dựa trên adType
  if (adType === "SB") return "SB01";
  return "SP03";
}

/**
 * Đánh giá ma trận luật chuyên biệt cho Glass Ornament
 */
export function evaluateOrnamentTargetBid(row: PpcPerformanceRow): PpcRecommendation | null {
  if (row.grain !== "TARGET" || row.isNegative) return null;
  if (/paused|archived/i.test(row.state || row.campaignState || row.adGroupState)) return null;
  if (!isGlassOrnamentTarget(row)) return null;

  const format = detectOrnamentCampaignType(row.campaignName, row.adType);
  const limits = ORNAMENT_BID_LIMITS[format];
  const baseCpc: number = typeof row.cpc === "number" && row.cpc > 0 ? row.cpc : 0;
  const currentBid: number = (row.bid && row.bid > 0) ? row.bid : (baseCpc > 0 ? baseCpc : limits.minBid);
  const avgCpc: number = row.clicks > 0 ? (row.spend / row.clicks) : (baseCpc > 0 ? baseCpc : currentBid);
  const hasOrders = row.orders > 0;
  const actualAcos = row.sales > 0 ? (row.spend / row.sales) * 100 : 999;

  let recType: RecommendationType | null = null;
  let actionState: "ENABLE" | "PAUSED" = "ENABLE";
  let targetBid = currentBid;
  let reason = "";
  let priority: "P0" | "P1" | "P2" = "P1";

  // ==========================================
  // NHÓM 1: KHI CÓ ĐƠN (Order > 0)
  // ==========================================
  if (hasOrders) {
    if (format === "SP03") {
      if (actualAcos < 25) {
        // Tăng bid +8% so với Bid hiện tại
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.08;
        reason = `[Glass Ornament SP03] ACOS ${actualAcos.toFixed(1)}% < 25% (hiệu quả cao) -> Tăng bid +8% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos < 35) {
        // Tăng bid +5% so với Bid hiện tại
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[Glass Ornament SP03] ACOS ${actualAcos.toFixed(1)}% nằm trong khoảng 25%-35% -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos <= 48) {
        // Vùng mục tiêu tối ưu (35% - 48% breakeven) -> Giữ nguyên
        return null;
      } else if (actualAcos <= 55) {
        // Giảm bid -8% so với CPC trung bình
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.92;
        reason = `[Glass Ornament SP03] ACOS ${actualAcos.toFixed(1)}% vượt điểm hòa vốn (48%-55%) -> Giảm bid -8% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      } else {
        // ACOS > 55% -> Giảm bid -15% so với CPC trung bình
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.85;
        priority = "P0";
        reason = `[Glass Ornament SP03] ACOS ${actualAcos.toFixed(1)}% > 55% (lỗ nặng) -> Giảm bid -15% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      }
    } else {
      // SB01 và SB05 dùng chung ngưỡng khi có đơn
      if (actualAcos < 15) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.08;
        reason = `[Glass Ornament ${format}] ACOS ${actualAcos.toFixed(1)}% < 15% (hiệu quả cao) -> Tăng bid +8% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos < 25) {
        recType = "BID_INCREASE";
        targetBid = currentBid * 1.05;
        reason = `[Glass Ornament ${format}] ACOS ${actualAcos.toFixed(1)}% nằm trong khoảng 15%-25% -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}).`;
      } else if (actualAcos <= 40) {
        // Vùng mục tiêu SB (25% - 40%) -> Giữ nguyên
        return null;
      } else if (actualAcos <= 48) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.92;
        reason = `[Glass Ornament ${format}] ACOS ${actualAcos.toFixed(1)}% tiệm cận hòa vốn (40%-48%) -> Giảm bid -8% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      } else {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.85;
        priority = "P0";
        reason = `[Glass Ornament ${format}] ACOS ${actualAcos.toFixed(1)}% > 48% (vượt điểm hòa vốn) -> Giảm bid -15% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      }
    }
  }

  // ==========================================
  // NHÓM 2: KHI KHÔNG CÓ ĐƠN (Order = 0)
  // ==========================================
  else {
    if (row.clicks < 1) {
      // Click < 1 (chưa có click) -> Tăng bid +5% so với Bid hiện tại để mồi traffic
      recType = "BID_INCREASE";
      targetBid = currentBid * 1.05;
      reason = `[Glass Ornament ${format}] 0 clicks trong kỳ -> Tăng bid +5% so với Bid hiện tại ($${currentBid.toFixed(2)}) để kích hoạt hiển thị.`;
    } else if (format === "SP03") {
      if (row.clicks > 10) {
        // Click > 10 -> Pause target
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = limits.minBid;
        reason = `[Glass Ornament SP03] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>10 clicks) -> Đề xuất Tạm dừng (Pause target), kiểm tra chu kỳ 30 ngày.`;
      } else if (row.clicks > 7) {
        // Click > 7 -> Giảm bid -10% so với CPC trung bình
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[Glass Ornament SP03] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>7 clicks) -> Giảm bid -10% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      } else {
        return null;
      }
    } else if (format === "SB05") {
      if (row.clicks > 11) {
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = limits.minBid;
        reason = `[Glass Ornament SB05] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>11 clicks) -> Đề xuất Tạm dừng (Pause target), kiểm tra chu kỳ 30 ngày.`;
      } else if (row.clicks > 8) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[Glass Ornament SB05] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>8 clicks) -> Giảm bid -10% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      } else {
        return null;
      }
    } else if (format === "SB01") {
      if (row.clicks > 13) {
        recType = "PAUSE_TARGET";
        actionState = "PAUSED";
        priority = "P0";
        targetBid = limits.minBid;
        reason = `[Glass Ornament SB01] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>13 clicks) -> Đề xuất Tạm dừng (Pause target), kiểm tra chu kỳ 30 ngày.`;
      } else if (row.clicks > 9) {
        recType = "BID_DECREASE";
        targetBid = avgCpc * 0.90;
        reason = `[Glass Ornament SB01] Đã tiêu ${row.clicks} clicks ($${row.spend.toFixed(2)}) không ra đơn (>9 clicks) -> Giảm bid -10% so với CPC trung bình ($${avgCpc.toFixed(2)}).`;
      } else {
        return null;
      }
    }
  }

  if (!recType) return null;

  // Kẹp chặt giữa Min Bid và Max Bid
  const clampedBid = Math.round(Math.min(limits.maxBid, Math.max(limits.minBid, targetBid)) * 100) / 100;

  if (recType !== "PAUSE_TARGET" && clampedBid === currentBid) {
    return null;
  }

  const estimatedSavings = recType === "BID_DECREASE" || recType === "PAUSE_TARGET"
    ? Math.round(row.spend * (1 - clampedBid / Math.max(currentBid, 0.01)) * 100) / 100
    : 0;

  return {
    id: `rec-ornament-${row.storeId || row.storeName}-${row.adType}-${row.targetId || row.entityId}`,
    storeId: row.storeId || "store-1",
    storeName: row.storeName || "HSOSTORE",
    adType: row.adType,
    recType,
    targetType: /asin|category|brand/i.test(row.targetExpression) ? "PRODUCT" : "EXACT",
    matchType: row.matchType,
    keyword: row.targetExpression || row.targetId,
    campaignName: row.campaignName,
    adGroupName: row.adGroupName,
    sku: row.sku || (row.campaignName ? row.campaignName.trim().split(/\s+/)[0] : ""),
    campaignId: row.campaignId,
    adGroupId: row.adGroupId,
    keywordId: row.targetId,
    priority,
    currentBid,
    recommendedBid: clampedBid,
    reason: `${reason} (Giới hạn trần/sàn: $${limits.minBid.toFixed(2)} - $${limits.maxBid.toFixed(2)})`,
    estimatedSavings: Math.max(0, estimatedSavings),
    status: "PENDING",
    productType: "Glass Ornament",
    ruleProfile: `Glass Ornament ${format}`,
    actionState,
    createdAt: new Date().toISOString(),
  };
}
