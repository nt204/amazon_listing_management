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

    const actualAcos =
      payload.sales && payload.sales > 0 && payload.spend !== undefined
        ? ((payload.spend / payload.sales) * 100).toFixed(1) + "%"
        : payload.clicks && payload.clicks > 0
        ? "Không có doanh thu"
        : "Chưa có click";

    const promptData = [
      `Từ khóa: "${payload.keyword}" (${payload.matchType || "Target"})`,
      payload.sku ? `SKU: ${payload.sku} (Phôi: ${payload.productType || "Chưa xác định"})` : null,
      payload.campaignName ? `Chiến dịch: ${payload.campaignName} (Bộ luật: ${payload.ruleProfile || "SP03 v1.0"})` : null,
      `Hành động: ${payload.recType === "PAUSE_TARGET" ? "Tạm dừng (PAUSE)" : payload.recType === "BID_INCREASE" ? "Tăng Bid" : "Giảm Bid"}`,
      `Bid hiện tại: $${(payload.currentBid || 0).toFixed(2)} -> Đề xuất mới: $${(payload.recommendedBid || 0).toFixed(2)}`,
      payload.clicks !== undefined ? `Số click: ${payload.clicks}` : null,
      payload.spend !== undefined ? `Chi phí (Spend): $${payload.spend.toFixed(2)}` : null,
      payload.sales !== undefined ? `Doanh thu (Sales): $${payload.sales.toFixed(2)}` : null,
      payload.orders !== undefined ? `Số đơn (Orders): ${payload.orders}` : null,
      payload.cpc !== undefined ? `Avg CPC thực tế: $${payload.cpc.toFixed(2)}` : null,
      `ACoS thực tế: ${actualAcos}`,
      payload.breakEvenAcos ? `ACoS hòa vốn của phôi (Break-even): ${payload.breakEvenAcos}%` : null,
      payload.maxBid ? `Trần Max Bid an toàn: $${payload.maxBid.toFixed(2)}` : null,
      payload.ruleReason ? `Nội dung luật hệ thống khớp: ${payload.ruleReason}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt = `Bạn là chuyên gia giải thích thuật toán đấu thầu Amazon PPC.
Nhiệm vụ: DỰA CHÍNH XÁC VÀO QUY TẮC LUẬT HỆ THỐNG VÀ DỮ LIỆU ĐƯỢC CUNG CẤP ĐỂ GIẢI THÍCH THEO ĐÚNG LOGIC CỦA LUẬT.
Cấu trúc câu trả lời bắt buộc (chính xác 3 gạch đầu dòng ngắn gọn, đi thẳng vào số liệu và công thức):

*   **Khớp điều kiện luật:** Nêu rõ chỉ số thực tế (ACoS, Clicks, Orders) đối chiếu với điều kiện của bộ luật (ví dụ: ACoS thực tế so với ACoS hòa vốn, hoặc số click chưa có đơn).
*   **Công thức áp dụng:** Nêu rõ hành động mà luật quy định thực hiện (ví dụ: +8% Current Bid, -15% Avg CPC, hoặc Pause target).
*   **Phép tính & Trần/Sàn:** Thể hiện phép tính số học cụ thể từ số liệu thực tế ra giá bid mới, và đối chiếu với trần Max Bid / sàn Min Bid (nếu bị chặn trần hoặc giữ nguyên thì nói rõ).

Quy tắc:
- Bắt buộc giải thích theo đúng cơ chế của bộ luật và số liệu được cung cấp, tuyệt đối không đưa ra lời khuyên chung chung.
- Không chào hỏi, không mở bài dài dòng.`;

    const response = await openai.chat.completions.create({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Dữ liệu target:\n${promptData}` },
      ],
      max_tokens: 2500,
      temperature: 0.1,
    });

    const explanation = response.choices[0]?.message?.content?.trim() || "Chưa có giải thích từ AI.";

    return NextResponse.json({
      success: true,
      explanation,
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
