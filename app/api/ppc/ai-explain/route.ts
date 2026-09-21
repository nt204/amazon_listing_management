import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

interface ExplainPayload {
  keyword: string;
  matchType?: string;
  campaignName?: string;
  recType: string;
  currentBid: number;
  recommendedBid: number;
  clicks?: number;
  spend?: number;
  sales?: number;
  orders?: number;
  cpc?: number;
  breakEvenAcos?: number;
  maxBid?: number;
  ruleReason?: string;
  sku?: string;
  productType?: string;
  ruleProfile?: string;
}

export async function POST(req: NextRequest) {
  try {
    const payload: ExplainPayload = await req.json();

    if (!payload.keyword || payload.recommendedBid === undefined) {
      return NextResponse.json({ error: "Thiếu dữ liệu từ khóa hoặc bid" }, { status: 400 });
    }

    const apiKey =
      process.env.CHEAPKEYAI_GEMINI_API_KEY?.trim() ||
      process.env.CHEAPKEYAI_API_KEY?.trim() ||
      "sk-IzoVgcASwqWE68gWNBHVZwFFc5IhcxSgPUudDv7X1qkEq2By";

    const baseURL = (process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1")
      .trim()
      .replace(/\/+$/, "");

    const openai = new OpenAI({
      apiKey,
      baseURL,
    });

    const actualAcosNum =
      payload.sales && payload.sales > 0 && payload.spend !== undefined
        ? Number(((payload.spend / payload.sales) * 100).toFixed(1))
        : null;

    const actualAcos =
      actualAcosNum !== null
        ? `${actualAcosNum}%`
        : payload.clicks && payload.clicks > 0
        ? "Không có doanh thu (0 đơn)"
        : "Chưa có click";

    // Phân tích bối cảnh quy tắc giúp AI hiểu cặn kẽ bản chất kinh doanh
    let zoneHint = "";
    if (actualAcosNum !== null && payload.breakEvenAcos) {
      if (actualAcosNum <= 20) {
        zoneHint = `[VÙNG HIỆU QUẢ CAO]: ACoS ${actualAcosNum}% <= 20%. Đang sinh lời rất tốt, tăng bid (+8% Current Bid) để tranh Top of Search.`;
      } else if (actualAcosNum <= 40) {
        zoneHint = `[VÙNG TỐI ƯU SINH LỜI]: ACoS ${actualAcosNum}% nằm trong khoảng 20% - 40%. Đang sinh lời cân bằng, giữ nguyên giá thầu (0%).`;
      } else if (actualAcosNum <= payload.breakEvenAcos) {
        zoneHint = `[VÙNG KIỂM SOÁT RỦI RO / CẬN HÒA VỐN]: ACoS ${actualAcosNum}% nằm trong khoảng [40% đến ACoS Hòa Vốn ${payload.breakEvenAcos}%]. CHÚ Ý: Mặc dù chưa bị lỗ (vì vẫn < ${payload.breakEvenAcos}%), nhưng đã vượt ngưỡng trần an toàn 40%. Hệ thống chủ động giảm nhẹ (-8% Avg CPC) để kéo ACoS về vùng sinh lời (< 40%) và phòng ngừa chi phí phình to.`;
      } else {
        zoneHint = `[VÙNG VƯỢT HÒA VỐN / THUA LỖ]: ACoS ${actualAcosNum}% > ACoS Hòa Vốn ${payload.breakEvenAcos}%. Đang lỗ trên từng đơn hàng, giảm mạnh (-15% Avg CPC) để cắt lỗ khẩn cấp.`;
      }
    } else if (payload.clicks && (!payload.orders || payload.orders === 0)) {
      if (payload.clicks <= 7) {
        zoneHint = `[VÙNG THĂM DÒ]: ${payload.clicks} clicks chưa ra đơn. Vẫn trong ngưỡng thu thập dữ liệu, giữ nguyên hoặc tăng nhẹ.`;
      } else if (payload.clicks <= 12) {
        zoneHint = `[VÙNG CẢNH BÁO CHI PHÍ]: ${payload.clicks} clicks chưa ra đơn. Đang tốn ngân sách, giảm bid (-10% Avg CPC) để hạn chế tổn thất.`;
      } else {
        zoneHint = `[VÙNG CẮT LỖ TRIỆT ĐỂ]: ${payload.clicks} clicks không có đơn (vượt trần tối đa). Tạm dừng target (PAUSE) để ngăn đốt tiền vô ích.`;
      }
    }

    const exactCpc = payload.clicks && payload.clicks > 0 && payload.spend !== undefined
      ? (payload.spend / payload.clicks)
      : (payload.cpc || 0);

    const promptData = [
      `Từ khóa: "${payload.keyword}" (${payload.matchType || "Target"})`,
      payload.sku ? `SKU: ${payload.sku} (Phôi: ${payload.productType || "Chưa xác định"})` : null,
      payload.campaignName ? `Chiến dịch: ${payload.campaignName} (Bộ luật: ${payload.ruleProfile || "SP03 v1.0"})` : null,
      `Hành động: ${payload.recType === "PAUSE_TARGET" ? "Tạm dừng (PAUSE)" : payload.recType === "BID_INCREASE" ? "Tăng Bid" : "Giảm Bid"}`,
      `Giá thầu: Hiện tại $${(payload.currentBid || 0).toFixed(2)} -> Đề xuất mới: $${(payload.recommendedBid || 0).toFixed(2)}`,
      payload.clicks !== undefined ? `Số click: ${payload.clicks}` : null,
      payload.spend !== undefined ? `Chi phí (Spend): $${payload.spend.toFixed(2)}` : null,
      payload.sales !== undefined ? `Doanh thu (Sales): $${payload.sales.toFixed(2)}` : null,
      payload.orders !== undefined ? `Số đơn (Orders): ${payload.orders}` : null,
      payload.spend !== undefined && payload.clicks ? `Avg CPC chính xác = $${payload.spend.toFixed(2)} / ${payload.clicks} click = $${exactCpc.toFixed(4)} (hiển thị $${exactCpc.toFixed(2)})` : `Avg CPC thực tế: $${(payload.cpc || 0).toFixed(2)}`,
      `ACoS thực tế: ${actualAcos}`,
      payload.breakEvenAcos ? `ACoS hòa vốn phôi (Break-even): ${payload.breakEvenAcos}%` : null,
      payload.maxBid ? `Trần Max Bid an toàn: $${payload.maxBid.toFixed(2)}` : null,
      payload.ruleReason ? `Tên luật khớp: ${payload.ruleReason}` : null,
      zoneHint ? `Ngữ cảnh vùng luật hệ thống: ${zoneHint}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt = `Bạn là chuyên gia giải thích quy tắc đấu thầu Amazon PPC.
Nhiệm vụ: Giải thích CỰC KỲ NGẮN GỌN (đúng 2 ý chính: LUẬT ÁP DỤNG và PHÉP TÍNH), TUYỆT ĐỐI KHÔNG DÀI DÒNG, KHÔNG NÓI LÝ THUYẾT ĐẤU GIÁ HAY LỜI KHUYÊN CHUNG CHUNG.

YÊU CẦU:
1. Luật áp dụng: Nêu rõ điều kiện thực tế đối chiếu với khoảng quy định của luật (nếu ACoS nằm trong khoảng 40% đến hòa vốn: nêu rõ "ACoS thực tế nằm trong khoảng [40% - ACoS hòa vốn], quy định giảm nhẹ -8% Avg CPC").
2. Phép tính: Nêu rõ phép tính số học cụ thể từ Avg CPC (hoặc Current Bid) ra Bid mới và đối chiếu trần/sàn.

TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ THEO ĐỊNH DẠNG:
{
  "ruleName": "Mã luật (ví dụ: SB01_HAS_ORDER_DECREASE)",
  "ruleCondition": "1 câu ngắn gọn nêu chỉ số thực tế khớp điều kiện nào (ví dụ: Có 1 đơn hàng, ACoS 41.9% nằm trong khoảng [40% - 63.2% hòa vốn] -> Quy định giảm -8% Avg CPC)",
  "formula": "Phép tính số học (ví dụ: $0.95 (Avg CPC) × 0.92 = $0.874)",
  "resultBid": "Bid mới sau làm tròn (ví dụ: $0.88)",
  "boundaryNote": "Đối chiếu trần/sàn (ví dụ: Sàn $0.10 ≤ $0.88 ≤ Trần $2.80)"
}`;

    const response = await openai.chat.completions.create({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Dữ liệu target:\n${promptData}` },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });

    const rawContent = response.choices[0]?.message?.content?.trim() || "";

    // Parse structured JSON safely
    let structured: any = null;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.warn("Could not parse AI explain JSON, constructing fallback", parseErr);
    }

    if (!structured || !structured.ruleCondition) {
      structured = buildFallbackStructured(rawContent, payload, actualAcosNum);
    }

    const cleanExplanation = `${structured.ruleCondition}\n${structured.formula} ➔ Đề xuất: ${structured.resultBid}`;

    return NextResponse.json({
      success: true,
      explanation: cleanExplanation,
      structured,
      model: "gemini-2.5-flash",
    });
  } catch (error: any) {
    console.error("Lỗi AI explain PPC:", error);
    return NextResponse.json(
      { error: error?.message || "Không thể gọi AI giải thích lúc này." },
      { status: 500 },
    );
  }
}

function buildFallbackStructured(rawContent: string, payload: ExplainPayload, actualAcosNum: number | null) {
  const beAcos = payload.breakEvenAcos ?? 48;
  const cpc = payload.cpc || payload.currentBid || 0;
  const isIncrease = payload.recType === "BID_INCREASE";
  const isPause = payload.recType === "PAUSE_TARGET";
  const isWarning = actualAcosNum !== null && actualAcosNum > 40 && actualAcosNum <= beAcos;

  let ruleCondition = "";
  if (isPause) {
    ruleCondition = `${payload.clicks || 0} clicks không ra đơn (vượt trần quy định) -> Tạm dừng (PAUSE).`;
  } else if (isIncrease) {
    ruleCondition = `ACoS ${actualAcosNum}% <= 20% (vùng hiệu quả cao) -> Tăng +8% Current Bid.`;
  } else if (isWarning) {
    ruleCondition = `ACoS ${actualAcosNum}% nằm trong khoảng [40% - ${beAcos}% hòa vốn] -> Quy định giảm -8% Avg CPC.`;
  } else if (actualAcosNum && actualAcosNum > beAcos) {
    ruleCondition = `ACoS ${actualAcosNum}% vượt ACoS hòa vốn (${beAcos}%) -> Giảm mạnh -15% Avg CPC.`;
  } else {
    ruleCondition = payload.ruleReason || `Khớp điều kiện quy tắc tối ưu.`;
  }

  const formula = isPause
    ? `Tạm dừng target (Bid = $${payload.recommendedBid.toFixed(2)})`
    : isIncrease
    ? `$${payload.currentBid.toFixed(2)} (Current Bid) × 1.08 = $${(payload.currentBid * 1.08).toFixed(3)}`
    : `$${cpc.toFixed(2)} (Avg CPC) × 0.92 = $${(cpc * 0.92).toFixed(3)}`;

  return {
    ruleName: payload.ruleReason ? payload.ruleReason.split(":")[0]?.replace(/\[.*?\]\s*/, "").trim() : "PPC_RULE",
    ruleCondition,
    formula,
    resultBid: `$${payload.recommendedBid.toFixed(2)}`,
    boundaryNote: payload.maxBid
      ? `Sàn $0.10 ≤ $${payload.recommendedBid.toFixed(2)} ≤ Trần $${payload.maxBid.toFixed(2)}`
      : `Nằm trong khoảng an toàn`,
  };
}
