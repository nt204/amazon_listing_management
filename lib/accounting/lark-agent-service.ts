import "server-only";

import {
  getAllStores,
  getDailyMetricsSummary,
  getOrderBreakdown,
  getReturnBreakdown,
  comparePerformancePeriods,
  getInboundShipments,
  listNegativeKeywords,
  listNegativeCandidates,
  requestNegativeKeywordAction,
  executeConfirmNegativeKeyword,
} from "./lark-agent-tools";
import {
  getConversationHistory,
  saveConversationTurn,
  getPendingAction,
  clearPendingAction,
  PendingPpcAction,
} from "./lark-conversation-memory";
import { sendLarkCardNotification, sendLarkTextNotification } from "@/lib/lark-notifications";

export interface ReconciliationButton {
  label: string;
  url: string;
}

/**
 * Phân tích câu hỏi và kết quả để đưa link đối soát phù hợp trên ncehub.net:
 * - Revenue: https://ncehub.net/?view=accounting&section=revenue
 * - Ads: https://ncehub.net/?view=accounting&section=ads
 * - PnL: https://ncehub.net/?view=accounting&section=pnl
 * - Lô hàng Inbound / Kho: https://ncehub.net/?view=accounting&section=inventory
 * - Đơn hàng: https://ncehub.net/?view=accounting&section=orders
 * - PPC: https://ncehub.net/?view=ppc&section=negative_keyword
 */
export function resolveContextualReconciliationLinks(
  query: string,
  toolsUsed: string[],
  replyText: string
): ReconciliationButton[] {
  const q = (query + " " + replyText).toLowerCase();
  const buttons: ReconciliationButton[] = [];
  const addedUrls = new Set<string>();

  function add(label: string, url: string) {
    if (!addedUrls.has(url)) {
      addedUrls.add(url);
      buttons.push({ label, url });
    }
  }

  // 1. PPC Negative Keywords / Tối ưu Ads / Search Term Candidate
  // Nếu câu hỏi hoặc thao tác liên quan tới Negative Keywords -> CHỈ hiển thị link PPC Negative, không hiển thị Inbound hay PnL!
  const isPpcNegative = (
    toolsUsed.includes("requestNegativeKeywordAction") ||
    toolsUsed.includes("executeConfirmNegativeKeyword") ||
    toolsUsed.includes("listNegativeKeywords") ||
    toolsUsed.includes("listNegativeCandidates") ||
    /negative|phủ định|chặn từ khóa|search term/i.test(query)
  );

  if (isPpcNegative) {
    add("🎯 Quản lý Negative Keywords", "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry");
    add("📋 Xem Lịch Sử Auto Upload", "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history");
    return buttons;
  }

  // 2. Inbound Shipments / Lô hàng / Chuyển kho (Chỉ kích hoạt khi hỏi cụ thể về lô hàng/kho, KHÔNG dùng regex fba đơn lẻ)
  if (
    toolsUsed.includes("getInboundShipments") ||
    /(lô hàng|inbound shipment|hàng đang về|vận chuyển kho|kiện hàng|chuyển kho fba)/i.test(q)
  ) {
    add("🚚 Đối soát Lô hàng Inbound", "https://ncehub.net/?view=accounting&section=inventory");
  }

  // 3. Chi phí Quảng cáo / Ads / PPC / ACOS / TACOS
  if (
    /ads|quảng cáo|acos|tacos|chi phí ads|ads spend|ppc/i.test(q)
  ) {
    add("📢 Đối soát Chi phí Ads", "https://ncehub.net/?view=accounting&section=ads");
  }

  // 4. Lợi nhuận / PnL / Net Profit / Gross Profit / Margin
  if (
    /pnl|p&l|lợi nhuận|net profit|gross profit|margin|lãi ròng|lãi gộp/i.test(q)
  ) {
    add("💵 Bảng đối soát P&L", "https://ncehub.net/?view=accounting&section=pnl");
  }

  // 5. Đơn hàng / Hoàn hàng / Orders / Returns
  if (
    toolsUsed.includes("getOrderBreakdown") ||
    toolsUsed.includes("getReturnBreakdown") ||
    /đơn hàng|orders|units sold|hoàn tiền|refund|trả hàng|return/i.test(q)
  ) {
    add("📦 Chi tiết Đơn hàng", "https://ncehub.net/?view=accounting&section=orders");
  }

  // 6. Doanh thu / Revenue (Mặc định nếu hỏi doanh thu hoặc chưa có nút nào)
  if (
    buttons.length === 0 ||
    /doanh thu|revenue|bán hàng|sales/i.test(q)
  ) {
    add("📊 Đối soát Revenue", "https://ncehub.net/?view=accounting&section=revenue");
  }

  return buttons.slice(0, 2);
}

/**
 * Chuẩn hóa đồng bộ font chữ trên Lark:
 * - Loại bỏ backtick (`) bọc inline code khiến chữ bị chuyển sang font monospace khung xám.
 * - Loại bỏ chữ nghiêng (*) khiến chữ bị lệch kiểu dáng so với chữ thường.
 * - Giữ lại in đậm (**) cho tiêu đề và số liệu chính.
 */
export function sanitizeUniformTypography(text: string): string {
  if (!text) return "";
  // 1. Chuyển `inline_code` thành chữ thường
  let clean = text.replace(/`([^`\n]+)`/g, "$1");
  // 2. Chuyển *italic* thành chữ thường, giữ nguyên **bold**
  clean = clean.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, "$1$2$3");
  // 3. Chuẩn hóa các ký tự bullet point con o, •, ◦ thành gạch đầu dòng chuẩn
  clean = clean.replace(/^[ \t]*[•◦o]\s+/gm, "  - ");
  return clean.trim();
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface RunAgentOptions {
  message: string;
  recipientEmail?: string;
  receiveId?: string;
  receiveIdType?: "email" | "chat_id" | "open_id";
  sessionId?: string; // Lưu và nhận diện ngữ cảnh trao đổi ngắn hạn
  replyToMessageId?: string; // Reply đúng tin nhắn của người hỏi (tránh nhầm khi nhóm đông)
  sendToLark?: boolean;
}

export interface AgentResult {
  replyText: string;
  toolsUsed: string[];
  larkSent: boolean;
  larkDetail?: any;
  actionLinks?: ReconciliationButton[];
}

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "getAllStores",
      description: "Lấy danh sách tất cả các store Amazon đang hoạt động trong hệ thống.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getDailyMetricsSummary",
      description: "Tra cứu doanh thu, lợi nhuận (P&L), chi phí Ads, phí Amazon, tiền hoàn hàng theo ngày hoặc khoảng ngày của một store hoặc tất cả store.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: 'BOZSPACER', 'LIMIMA', 'WARMSTOREY', 'FASTPEACE', 'MALFIRST') hoặc để trống nếu muốn lấy tất cả." },
          startDate: { type: "string", description: "Ngày bắt đầu (YYYY-MM-DD)." },
          endDate: { type: "string", description: "Ngày kết thúc (YYYY-MM-DD)." },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getOrderBreakdown",
      description: "Tra cứu chi tiết số đơn hàng (orders), số lượng sản phẩm (units), doanh thu theo từng SKU và trạng thái đơn hàng.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store hoặc để trống." },
          startDate: { type: "string", description: "Ngày bắt đầu (YYYY-MM-DD)." },
          endDate: { type: "string", description: "Ngày kết thúc (YYYY-MM-DD)." },
          sku: { type: "string", description: "Mã SKU cần lọc cụ thể (tùy chọn)." },
          limit: { type: "number", description: "Số lượng bản ghi tối đa (mặc định 10)." },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getReturnBreakdown",
      description: "Tra cứu chi tiết hoàn hàng / trả hàng (refund cost, return units, lý do hoàn tiền) theo store và khoảng ngày.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store hoặc để trống." },
          startDate: { type: "string", description: "Ngày bắt đầu (YYYY-MM-DD)." },
          endDate: { type: "string", description: "Ngày kết thúc (YYYY-MM-DD)." },
          limit: { type: "number", description: "Số lượng bản ghi tối đa." },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "comparePerformancePeriods",
      description: "So sánh hiệu quả hoạt động giữa hai chu kỳ thời gian (ví dụ tuần này vs tuần trước, tháng này vs tháng trước) tự động tính chênh lệch tuyệt đối và % tăng giảm.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store hoặc để trống." },
          period1: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "YYYY-MM-DD" },
              endDate: { type: "string", description: "YYYY-MM-DD" },
              label: { type: "string", description: "Tên nhãn (VD: 'Tháng 9')" },
            },
            required: ["startDate", "endDate"],
          },
          period2: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "YYYY-MM-DD" },
              endDate: { type: "string", description: "YYYY-MM-DD" },
              label: { type: "string", description: "Tên nhãn (VD: 'Tháng 10')" },
            },
            required: ["startDate", "endDate"],
          },
        },
        required: ["period1", "period2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getInboundShipments",
      description: "Tra cứu danh sách các lô hàng đang đi đến kho Amazon FBA (Inbound shipments), mã shipment ID, số lượng, trạng thái đã nhận hay đang trên đường.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store hoặc để trống." },
          sku: { type: "string", description: "Mã SKU cần tra cứu lô hàng." },
          status: { type: "string", enum: ["pending", "received", "all"], description: "Trạng thái lô hàng: 'pending' (chưa nhận đủ), 'received' (đã nhận xong), 'all' (tất cả)." },
          limit: { type: "number", description: "Số lượng lô hàng tối đa." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listNegativeKeywords",
      description: "Tra cứu danh sách các từ khóa ĐANG nằm trong danh sách phủ định (Negative Registry / Hub) của một store hoặc tất cả store.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE) hoặc để trống để lấy tất cả." },
          search: { type: "string", description: "Từ khóa hoặc tên campaign cần lọc tìm kiếm." },
          limit: { type: "number", description: "Số lượng từ khóa tối đa hiển thị (mặc định 15)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listNegativeCandidates",
      description: "Tra cứu danh sách các Search Terms lãng phí tiền (Clicks cao, 0 đơn) CẦN phủ định của một store hoặc tất cả store. Trả về danh sách có số thứ tự (STT) để người dùng có thể chọn phủ định.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE) hoặc để trống." },
          minClicks: { type: "number", description: "Số lượng clicks tối thiểu không ra đơn (mặc định 10)." },
          limit: { type: "number", description: "Số lượng search terms tối đa hiển thị (mặc định 10)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "requestNegativeKeywordAction",
      description: "Khởi tạo yêu cầu phủ định một hoặc nhiều từ khóa (Negative Exact) cho store trong hệ thống PPC. Hỗ trợ truyền danh sách tên từ khóa ('keywords') hoặc chọn theo số thứ tự ('itemIndices') từ danh sách vừa tra cứu. Thao tác này sẽ hiển thị Thẻ Xác Nhận Đơn Giản, Dễ Nhìn để người dùng bấm nút hoặc nhắn 'Xác nhận' trước khi auto upload.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE,...)" },
          keyword: { type: "string", description: "Từ khóa cần phủ định (nếu chỉ có 1 từ)." },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Danh sách một hoặc nhiều từ khóa cần phủ định cùng lúc.",
          },
          itemIndices: {
            type: "array",
            items: { type: "number" },
            description: "Danh sách số thứ tự (STT) từ bảng search terms vừa được gợi ý (ví dụ: [1, 2, 3]).",
          },
          matchType: { type: "string", enum: ["negativeExact", "negativePhrase"], description: "Loại phủ định: 'negativeExact' (mặc định) hoặc 'negativePhrase'." },
          campaignName: { type: "string", description: "Tên chiến dịch cần áp dụng hoặc để trống để tự động map theo campaign gốc." },
          reason: { type: "string", description: "Lý do phủ định (VD: ACOS quá cao 130%, Click nhiều không ra sale,...)" },
        },
      },
    },
  },
];

const SESSION_STATE_TOOLS = new Set(["listNegativeCandidates", "requestNegativeKeywordAction"]);

async function executeTool(name: string, rawArgs: string, sessionId?: string): Promise<string> {
  try {
    const args = JSON.parse(rawArgs || "{}");
    switch (name) {
      case "getAllStores":
        return JSON.stringify(await getAllStores());
      case "getDailyMetricsSummary":
        return JSON.stringify(await getDailyMetricsSummary(args));
      case "getOrderBreakdown":
        return JSON.stringify(await getOrderBreakdown(args));
      case "getReturnBreakdown":
        return JSON.stringify(await getReturnBreakdown(args));
      case "comparePerformancePeriods":
        return JSON.stringify(await comparePerformancePeriods(args));
      case "getInboundShipments":
        return JSON.stringify(await getInboundShipments(args));
      case "listNegativeKeywords":
        return JSON.stringify(await listNegativeKeywords(args));
      case "listNegativeCandidates":
        return JSON.stringify(await listNegativeCandidates(args, sessionId));
      case "requestNegativeKeywordAction":
        return JSON.stringify(await requestNegativeKeywordAction(args, sessionId));
      default:
        return JSON.stringify({ error: `Không tìm thấy công cụ: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || "Lỗi thực thi công cụ." });
  }
}

/**
 * Xử lý tin nhắn hỏi đáp Kế toán & Vận hành qua AI Agent (Gemini 3.8 Flash via CheapKey)
 */
export async function runAccountingAgent(options: RunAgentOptions): Promise<AgentResult> {
  const targetReceiveId = (options.receiveId || options.recipientEmail || "").trim();
  const targetReceiveIdType = (options.receiveIdType || (targetReceiveId.includes("@") ? "email" : "chat_id")).trim();

  // 1. KIỂM TRA THAO TÁC PPC ĐANG CHỜ XÁC NHẬN (NẾU CÓ SESSION ID)
  if (options.sessionId) {
    const pending = await getPendingAction(options.sessionId);
    if (pending) {
      const trimmed = options.message.trim().toLowerCase();
      const isConfirm = /^(xác nhận|xac nhan|đồng ý|dong y|ok|đẩy đi|day di|yes|y|confirm|duyệt|duyet|tiến hành|tien hanh)/i.test(trimmed);
      const isCancel = /^(hủy|huy|cancel|bỏ qua|bo qua|không|khong|stop|dừng|dung)/i.test(trimmed);

      if (isConfirm) {
        const execResult = await executeConfirmNegativeKeyword(pending);
        await clearPendingAction(options.sessionId);

        const items = pending.items && pending.items.length > 0 
          ? pending.items 
          : [{ keyword: pending.keyword || "", campaignName: pending.campaignName || pending.storeName }];

        const kwListFormatted = items
          .map((it, idx) => `${idx + 1}. **${it.keyword}** *(Camp: ${it.campaignName})*`)
          .join("\n");

        const successText = `🟢 **ĐÃ AUTO UPLOAD PHỦ ĐỊNH THÀNH CÔNG!**
- **Store:** ${pending.storeName}
- **Số lượng:** ${execResult.count} từ khóa
${execResult.fileName ? `- **File Bulksheet:** ${execResult.fileName}\n` : ""}
**Danh sách từ khóa đã phủ định:**
${kwListFormatted}

Hệ thống đã lưu vào Negative Hub${execResult.bulksheetCreated ? " và xếp hàng Auto Upload qua Mac mini worker đẩy lên Amazon Seller Central" : ""}.`;

        await saveConversationTurn(options.sessionId, options.message, successText);

        if (options.sendToLark && targetReceiveId) {
          const successCard = {
            schema: "2.0",
            config: { width_mode: "fill" },
            header: {
              template: "green",
              title: { tag: "plain_text", content: "🟢 Auto Upload Negative Thành Công" },
            },
            body: {
              elements: [
                { tag: "markdown", content: successText },
                {
                  tag: "column_set",
                  flex_mode: "bisect",
                  background_style: "default",
                  columns: [
                    {
                      tag: "column",
                      width: "weighted",
                      weight: 1,
                      elements: [
                        {
                          tag: "button",
                          text: { tag: "plain_text", content: "🎯 Xem Negative Hub" },
                          type: "primary",
                          width: "fill",
                          multi_url: {
                            url: "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry",
                            pc_url: "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry",
                            android_url: "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry",
                            ios_url: "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry",
                          },
                        },
                      ],
                    },
                    {
                      tag: "column",
                      width: "weighted",
                      weight: 1,
                      elements: [
                        {
                          tag: "button",
                          text: { tag: "plain_text", content: "📋 Xem Lịch Sử Auto Upload" },
                          type: "default",
                          width: "fill",
                          multi_url: {
                            url: "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history",
                            pc_url: "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history",
                            android_url: "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history",
                            ios_url: "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history",
                          },
                        },
                      ],
                    },
                  ],
                },
                { tag: "hr" },
                { tag: "markdown", content: "AI Agent | Tự động hóa PPC Amazon FBA" },
              ],
            },
          };
          await sendLarkCardNotification(successCard, {
            receiveId: targetReceiveId,
            receiveIdType: targetReceiveIdType,
            replyToMessageId: options.replyToMessageId,
          }).catch(console.error);
        }

        return {
          replyText: successText,
          toolsUsed: ["executeConfirmNegativeKeyword"],
          larkSent: true,
          larkDetail: { status: "confirmed_negative", count: execResult.count },
          actionLinks: [
            { label: "🎯 Xem Negative Hub", url: "https://ncehub.net/?view=ppc&section=negative_keyword&subtab=registry" },
            { label: "📋 Xem Lịch Sử Auto Upload", url: "https://ncehub.net/?view=ppc&section=negative_keyword&drawer=history" },
          ],
        };
      } else if (isCancel) {
        await clearPendingAction(options.sessionId);

        const cancelText = `❌ **ĐÃ HỦY THAO TÁC**\nĐã hủy yêu cầu phủ định từ khóa của store **${pending.storeName}**. Không có thay đổi nào được ghi vào hệ thống.`;
        await saveConversationTurn(options.sessionId, options.message, cancelText);

        if (options.sendToLark && targetReceiveId) {
          const cancelCard = {
            schema: "2.0",
            config: { width_mode: "fill" },
            header: {
              template: "grey",
              title: { tag: "plain_text", content: "❌ Đã Hủy Thao Tác Phủ Định" },
            },
            body: {
              elements: [
                { tag: "markdown", content: cancelText },
                { tag: "hr" },
                { tag: "markdown", content: "AI Agent | Tự động hóa PPC Amazon FBA" },
              ],
            },
          };
          await sendLarkCardNotification(cancelCard, {
            receiveId: targetReceiveId,
            receiveIdType: targetReceiveIdType,
            replyToMessageId: options.replyToMessageId,
          }).catch(console.error);
        }

        return {
          replyText: cancelText,
          toolsUsed: ["cancelPendingAction"],
          larkSent: true,
          larkDetail: { status: "cancelled_negative" },
        };
      }
    }
  }

  const apiKey = (process.env.LARK_AGENT_KEY || process.env.CHEAPKEYAI_API_KEY || "").trim();
  const baseUrl = (process.env.LARK_AGENT_BASE_URL || "https://cheapkeyai.shop/v1").replace(/\/+$/, "");
  const model = (process.env.LARK_AGENT_MODEL || "gemini-3.5-flash-lite").trim();

  if (!apiKey) {
    throw new Error("Chưa cấu hình LARK_AGENT_KEY trong file .env");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = `Bạn là AI Agent chuyên trách Kế Toán & Vận Hành Amazon FBA trên Lark Bot.
TỰ XƯNG & ĐỊNH DANH: Luôn xưng là "AI Agent" (Tuyệt đối KHÔNG bao giờ nhắc đến tên model hay công nghệ nền tảng).
Hôm nay là: ${todayStr}.
Các store hiện có trong hệ thống: BOZSPACER, FASTPEACE, LIMIMA, MALFIRST, WARMSTOREY.

QUY TẮC BẮT BUỘC:
1. NGUYÊN TẮC TUYỆT ĐỐI "HỎI GÌ TRẢ LỜI ĐÓ - KHÔNG TRẢ LỜI THỪA/KÈM CHỈ SỐ KHÁC":
   - Khi người dùng hỏi đích danh 1 chỉ số cụ thể:
     * Người dùng hỏi "ACOS" -> CHỈ TRẢ LỜI DUY NHẤT CON SỐ ACOS. TUYỆT ĐỐI KHÔNG tự tiện đưa thêm TACOS hay Ads Spend vào!
       Ví dụ đúng: "ACOS của store LIMIMA ngày 23/10/2026 là **95.2%**."
     * Người dùng hỏi "TACOS" -> CHỈ TRẢ LỜI DUY NHẤT TACOS.
     * Người dùng hỏi "Ads Spend" (hoặc "chi phí ads", "tiền ads") -> CHỈ TRẢ LỜI Ads Spend, KHÔNG tự đưa ACOS/TACOS.
     * Người dùng hỏi "Doanh thu" (Revenue) -> CHỈ TRẢ LỜI Revenue, KHÔNG tự kèm Orders hay Profit.
     * Người dùng hỏi "Đơn hàng" (Orders) -> CHỈ TRẢ LỜI Orders / Units Sold.
     * Người dùng hỏi "Lợi nhuận" (Net Profit) -> CHỈ TRẢ LỜI Net Profit.
     * Người dùng hỏi "Lô hàng" (Inbound Shipments) -> CHỈ báo cáo về Inbound Shipments.
   - CHỈ trả lời cụm nhiều chỉ số khi:
     * Người dùng hỏi bao quát: "chỉ số ads", "tình hình ads" -> Mới đưa cụm (Ads Spend, ACOS, TACOS).
     * Người dùng hỏi "báo cáo đầy đủ", "báo cáo tổng quan", "tổng kết", hoặc người dùng chủ động liệt kê nhiều chỉ số trong câu hỏi.
   - Định dạng trả lời cho câu hỏi 1 chỉ số:
     * Trả lời thẳng thắn, trực diện trong 1 dòng ngắn gọn. TUYỆT ĐỐI KHÔNG vẽ danh sách gạch đầu dòng nhiều mục thừa thãi!

2. TOÀN BỘ CHỈ SỐ KẾ TOÁN DÙNG TIẾNG ANH CHUẨN:
   - Doanh thu: "Revenue"
   - Số đơn hàng: "Orders"
   - Số lượng bán: "Units Sold"
   - Chi phí quảng cáo: "Ads Spend" (hoặc "Ads Fee")
   - Chi phí hoàn tiền / Trả hàng: "Refund Cost" (hoặc "Return Cost")
   - Phí sàn Amazon: "Amazon Fees" (hoặc "FBA Fees")
   - Lợi nhuận gộp: "Gross Profit"
   - Lợi nhuận ròng: "Net Profit"
   - Tỷ suất lợi nhuận: "Profit Margin" (hoặc "Margin")
   - Chỉ số quảng cáo: "ACOS", "TACOS", "ROI"
   - Lô hàng đang chuyển kho: "Inbound Shipments" (Status: "En Route", "Receiving", "Received")
   - Giá vốn: "Basecost"

3. ĐỒNG BỘ FONT CHỮ TUYỆT ĐỐI (TRÁNH LỆCH FONT TRÊN LARK):
   - TUYỆT ĐỐI KHÔNG dùng dấu backtick (\`) để bọc mã SKU, mã Shipment hay tên store. Hãy viết chữ in hoa thông thường (VD: FBA19S870Z0D, GOTT2906V03, BOZSPACER).
   - TUYỆT ĐỐI KHÔNG dùng chữ nghiêng (*) hoặc (_) cho tên sản phẩm, mã SKU.
   - Toàn bộ nội dung trả lời phải đồng bộ cùng một kiểu font chữ thường, chỉ dùng in đậm (**) cho tiêu đề và tên chỉ số.

4. TRẢ LỜI NGẮN GỌN, ĐẸP, ĐỒNG BỘ FORMAT:
   - Dùng icon trực quan tương ứng: 📊 Report, 💰 Revenue, 📦 Orders / Units Sold, 📢 Ads Spend, 🔄 Refund Cost, 💵 Gross Profit / Net Profit, 🚚 Inbound Shipments.
   - Dùng chỉ báo màu sắc khi so sánh: 🟢 (Tốt / Tăng Net Profit / Giảm Chi Phí), 🔴 (Xấu / Giảm Net Profit / Tăng Refund), 🔺 (Tăng), 🔻 (Giảm).
   - Số tiền luôn định dạng có dấu phẩy và ký hiệu $: VD: $42,500. Tỷ lệ % có 1 chữ số thập phân: VD: 24.5%.
   - TUYỆT ĐỐI KHÔNG viết dài dòng thừa thãi. Hỏi 1 chỉ số -> Trả lời 1 câu trực diện. Hỏi tổng hợp -> 3 - 5 dòng ngắn gọn.

5. TUYỆT ĐỐI KHÔNG BỊA ĐẶT - KHÔNG CÓ DỮ LIỆU THÌ BÁO KHÔNG CÓ DỮ LIỆU:
   - TUYỆT ĐỐI KHÔNG tự suy đoán, ước lượng hoặc bịa số liệu kế toán. Mọi con số bắt buộc phải lấy từ kết quả thực thi tools.
   - Nếu tools trả về hasData: false hoặc thông báo không tìm thấy:
     * Trả lời thẳng thắn và chính xác: "Chưa có dữ liệu kế toán cho khoảng thời gian này."
     * Nếu store không tồn tại: "Không tìm thấy store trong hệ thống."
     * Nếu không có lô hàng: "Hiện không có lô hàng nào đang vận chuyển."
     * Nếu không có đơn hàng cho SKU: "Không có dữ liệu đơn hàng cho SKU này."
   - Không được tự tiện biến việc "chưa có dữ liệu" thành con số $0 khi ngày đó chưa được đối soát hoặc chưa import.

6. QUY TRÌNH TRA CỨU & PHỦ ĐỊNH TỪ KHÓA (NEGATIVE KEYWORDS):
   - KHI NGƯỜI DÙNG HỎI DANH SÁCH TỪ KHÓA CẦN PHỦ ĐỊNH / LÃNG PHÍ CLICKS / ĐỐT TIỀN:
     * Nếu hỏi danh sách từ khóa ĐANG phủ định trong Hub -> Gọi tool "listNegativeKeywords".
     * Nếu hỏi danh sách từ khóa CẦN phủ định / lãng phí -> Gọi tool "listNegativeCandidates" (lấy tối đa 5 từ khóa lãng phí nhất để nội dung ngắn gọn, súc tích).
     * CÁCH TRÌNH BÀY DANH SÁCH TỪ KHÓA LÃNG PHÍ (GỌN GÀNG, ĐẸP MẮT):
       - TUYỆT ĐỐI KHÔNG dùng bảng ngang nhiều cột (vì tên Campaign rất dài làm bảng bị tràn và vỡ giao diện trên điện thoại & máy tính).
       - Trình bày dạng DANH SÁCH ĐÁNH SỐ (1, 2, 3...) GỌN GÀNG theo mẫu sau:
         [STT]. **[Search Term]** ([Tên Store])
         • Clicks: [Số clicks] | Lãng phí: $[Số tiền spend] (0 đơn)
         • Campaign: [Tên campaign]
       - Phía dưới danh sách có lời nhắc ngắn gọn:
         "💡 Hướng dẫn tiếp theo:
         Bạn có thể nhắn số thứ tự (ví dụ: 'Phủ định từ số 1, 2') hoặc gõ trực tiếp tên từ khóa để AI Agent tạo yêu cầu phủ định."
   - KHI NGƯỜI DÙNG YÊU CẦU PHỦ ĐỊNH (1 HOẶC NHIỀU TỪ KHÓA HOẶC THEO STT):
     * BẮT BUỘC gọi tool "requestNegativeKeywordAction".
     * KHI TOOL TRẢ VỀ: Thao tác CHƯA được ghi vào hệ thống ngay. AI Agent BẮT BUỘC hiển thị Thẻ Xác Nhận ĐƠN GIẢN, DỄ NHÌN với thông tin:
       - Store: [Tên Store]
       - Số lượng từ khóa: [N] từ
       - Liệt kê danh sách từng từ khóa kèm Campaign tương ứng.
       - Hỏi người dùng có xác nhận auto đẩy (tạo Bulksheet & lưu vào Hub) không.
       - Hướng dẫn bấm nút [Xác nhận đẩy ngay] hoặc nhắn "Xác nhận", hoặc "Hủy" để bỏ qua.
     * TUYỆT ĐỐI KHÔNG tự tiện báo "Đã phủ định thành công" ở bước này!`;

  // Tải lịch sử hội thoại gần đây (nếu có sessionId)
  const conversationHistory = options.sessionId
    ? await getConversationHistory(options.sessionId)
    : [];

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    { role: "user", content: options.message },
  ];

  const toolsUsed: string[] = [];

  async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err: any) {
        lastErr = err;
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
    }
    throw lastErr;
  }

  // Vòng lặp Function Calling (Tối đa 4 vòng). Vòng cuối không gửi tools để
  // model buộc phải trả lời, tránh kết thúc bằng "Không có phản hồi."
  const maxSteps = 4;
  for (let step = 0; step < maxSteps; step++) {
    const allowTools = step < maxSteps - 1;
    const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(allowTools ? { tools: TOOLS_SCHEMA, tool_choice: "auto" } : {}),
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API lỗi (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("AI không trả về kết quả.");

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // Nếu không cần gọi tool nữa -> đã có câu trả lời cuối cùng
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      break;
    }

    // Tool chỉ đọc chạy song song cho nhanh; tool dùng state phiên (danh sách
    // candidate -> yêu cầu phủ định) phải chạy tuần tự đúng thứ tự model gọi.
    const toolCalls: ToolCall[] = assistantMsg.tool_calls;
    toolsUsed.push(...toolCalls.map((toolCall) => toolCall.function.name));
    const runTool = (toolCall: ToolCall) =>
      executeTool(toolCall.function.name, toolCall.function.arguments, options.sessionId);
    const hasSessionTool = toolCalls.some((toolCall) => SESSION_STATE_TOOLS.has(toolCall.function.name));
    const toolResults: string[] = [];
    if (hasSessionTool) {
      for (const toolCall of toolCalls) toolResults.push(await runTool(toolCall));
    } else {
      toolResults.push(...(await Promise.all(toolCalls.map(runTool))));
    }
    toolCalls.forEach((toolCall, index) => {
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: toolResults[index],
      });
    });
  }

  const lastMsg = messages[messages.length - 1];
  const rawReplyText = lastMsg.role === "assistant" && lastMsg.content ? lastMsg.content : "Không có phản hồi.";
  
  // Chuẩn hóa đồng bộ font chữ (loại bỏ inline code backticks và italics gây lệch font trên Lark)
  let replyText = sanitizeUniformTypography(rawReplyText);
  const cleanReportContent = replyText;

  // Xác định các link đối soát phù hợp dựa trên nội dung câu hỏi và tools được gọi
  const isAwaitingNegativeConfirmation = toolsUsed.includes("requestNegativeKeywordAction");
  const recButtons = resolveContextualReconciliationLinks(options.message, toolsUsed, replyText);

  // Đính kèm link markdown vào cuối text (cho text notification hoặc API response)
  if (!isAwaitingNegativeConfirmation && recButtons.length > 0) {
    const linkStr = recButtons.map((b) => `[${b.label}](${b.url})`).join("  •  ");
    replyText += `\n\n🔗 **Link đối soát hệ thống:**\n${linkStr}`;
  }

  // Lưu lượt trao đổi vào bộ nhớ ngắn hạn
  if (options.sessionId) {
    await saveConversationTurn(options.sessionId, options.message, replyText);
  }

  let larkSent = false;
  let larkDetail: any = null;

  // Gửi thông báo đến Lark nếu được yêu cầu
  if (options.sendToLark && targetReceiveId) {
    try {
      // Khi đã có nút bấm ở dưới thẻ, dùng cleanReportContent để tránh bị lặp đôi link
      const cardMarkdownContent = recButtons.length > 0 ? cleanReportContent : replyText;

      let cardElements: any[] = [
        {
          tag: "markdown",
          content: cardMarkdownContent,
        },
      ];

      let cardTemplate = "blue";
      let cardTitle = "📊 AI Agent - Accounting & Operations";

      if (isAwaitingNegativeConfirmation && options.sessionId) {
        // Hộp thoại xác nhận đơn giản, dễ nhìn với 2 nút bấm Xác nhận / Hủy
        cardTemplate = "orange";
        cardTitle = "⚠️ Xác Nhận Auto Upload Phủ Định (PPC)";
        cardElements.push({
          tag: "column_set",
          flex_mode: "bisect",
          background_style: "default",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: "✅ Xác nhận đẩy ngay",
                  },
                  type: "primary",
                  width: "fill",
                  value: {
                    action: "CONFIRM_NEGATIVE",
                    sessionId: options.sessionId,
                  },
                },
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: "❌ Hủy bỏ",
                  },
                  type: "danger",
                  width: "fill",
                  value: {
                    action: "CANCEL_NEGATIVE",
                    sessionId: options.sessionId,
                  },
                },
              ],
            },
          ],
        });
      } else if (recButtons.length > 0) {
        // Render nút bấm mở Link đối soát tương ứng
        if (recButtons.length === 1) {
          cardElements.push({
            tag: "button",
            text: {
              tag: "plain_text",
              content: recButtons[0].label,
            },
            type: "primary",
            multi_url: {
              url: recButtons[0].url,
              pc_url: recButtons[0].url,
              android_url: recButtons[0].url,
              ios_url: recButtons[0].url,
            },
          });
        } else {
          cardElements.push({
            tag: "column_set",
            flex_mode: "bisect",
            background_style: "default",
            columns: recButtons.map((btn) => ({
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: btn.label,
                  },
                  type: "primary",
                  width: "fill",
                  multi_url: {
                    url: btn.url,
                    pc_url: btn.url,
                    android_url: btn.url,
                    ios_url: btn.url,
                  },
                },
              ],
            })),
          });
        }
      }

      cardElements.push(
        { tag: "hr" },
        {
          tag: "markdown",
          content: isAwaitingNegativeConfirmation
            ? "AI Agent | Tự động hóa PPC Amazon FBA (Mac mini worker)"
            : "AI Agent | Dữ liệu thời gian thực từ Amazon Database",
        }
      );

      const larkCard = {
        schema: "2.0",
        config: {
          width_mode: "fill",
        },
        header: {
          template: cardTemplate,
          title: {
            tag: "plain_text",
            content: cardTitle,
          },
        },
        body: {
          elements: cardElements,
        },
      };

      try {
        const sendRes = await sendLarkCardNotification(larkCard, {
          receiveId: targetReceiveId,
          receiveIdType: targetReceiveIdType,
          replyToMessageId: options.replyToMessageId,
        });
        if (sendRes.sent) {
          larkSent = true;
          larkDetail = { status: "sent_card", to: targetReceiveId, type: targetReceiveIdType };
        } else {
          throw new Error(sendRes.reason || "Lark not configured");
        }
      } catch (cardErr: any) {
        // Fallback text notification
        const textRes = await sendLarkTextNotification(replyText, {
          receiveId: targetReceiveId,
          receiveIdType: targetReceiveIdType,
          replyToMessageId: options.replyToMessageId,
        });
        larkSent = textRes.sent;
        larkDetail = {
          status: textRes.sent ? "sent_text_fallback" : "failed",
          cardError: cardErr.message,
          to: targetReceiveId,
          type: targetReceiveIdType,
        };
      }
    } catch (e: any) {
      larkSent = false;
      larkDetail = { error: e.message };
    }
  }

  return {
    replyText,
    toolsUsed,
    larkSent,
    larkDetail,
    actionLinks: recButtons,
  };
}
