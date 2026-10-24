import "server-only";

import {
  getAllStores,
  getDailyMetricsSummary,
  getOrderBreakdown,
  getReturnBreakdown,
  comparePerformancePeriods,
  getInboundShipments,
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

  // 1. Inbound Shipments / Lô hàng / Chuyển kho
  if (
    toolsUsed.includes("getInboundShipments") ||
    /lô hàng|inbound|chuyển kho|en route|vận chuyển|kiện hàng|fba1|fba/i.test(q)
  ) {
    add("🚚 Đối soát Lô hàng Inbound", "https://ncehub.net/?view=accounting&section=inventory");
  }

  // 2. PPC Negative Keywords / Tối ưu Ads
  if (
    toolsUsed.includes("requestNegativeKeywordAction") ||
    toolsUsed.includes("executeConfirmNegativeKeyword") ||
    /negative|phủ định|chặn từ khóa|search term/i.test(q)
  ) {
    add("🎯 Quản lý Negative Keywords", "https://ncehub.net/?view=ppc&section=negative_keyword");
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
      name: "requestNegativeKeywordAction",
      description: "Khởi tạo yêu cầu phủ định từ khóa (Negative Exact hoặc Negative Phrase) cho store trong hệ thống PPC. Lưu ý: Thao tác này sẽ hiển thị Thẻ Xác Nhận hỏi người dùng và chỉ được auto đẩy sau khi người dùng bấm nút xác nhận hoặc nhắn 'Xác nhận'.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE,...)" },
          keyword: { type: "string", description: "Từ khóa cần phủ định (VD: running shoes cheap)" },
          matchType: { type: "string", enum: ["negativeExact", "negativePhrase"], description: "Loại phủ định: 'negativeExact' (mặc định) hoặc 'negativePhrase'." },
          campaignName: { type: "string", description: "Tên chiến dịch cần áp dụng hoặc để trống cho toàn bộ chiến dịch store." },
          reason: { type: "string", description: "Lý do phủ định (VD: ACOS quá cao 130%, Click nhiều không ra sale,...)" },
        },
        required: ["storeQuery", "keyword"],
      },
    },
  },
];

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
        await executeConfirmNegativeKeyword(pending);
        await clearPendingAction(options.sessionId);

        const successText = `🟢 ĐÃ TỰ ĐỘNG ĐẨY THÀNH CÔNG!\nĐã thêm từ khóa **${pending.keyword}** (${pending.matchType}) vào danh sách Phủ định của store **${pending.storeName}**.\n\nHệ thống PPC sẽ tự động áp dụng để chặn các lượt click không chuyển đổi.`;
        await saveConversationTurn(options.sessionId, options.message, successText);

        if (options.sendToLark && targetReceiveId) {
          const successCard = {
            schema: "2.0",
            config: { width_mode: "fill" },
            header: {
              template: "green",
              title: { tag: "plain_text", content: "🟢 Tự Động Đẩy Negative Thành Công" },
            },
            body: {
              elements: [
                { tag: "markdown", content: successText },
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "🎯 Xem Bảng Quản Lý Negative Keywords" },
                  type: "primary",
                  multi_url: {
                    url: "https://ncehub.net/?view=ppc&section=negative_keyword",
                    pc_url: "https://ncehub.net/?view=ppc&section=negative_keyword",
                    android_url: "https://ncehub.net/?view=ppc&section=negative_keyword",
                    ios_url: "https://ncehub.net/?view=ppc&section=negative_keyword",
                  },
                },
                { tag: "hr" },
                { tag: "markdown", content: "AI Agent | Tự động hóa PPC Amazon FBA" },
              ],
            },
          };
          await sendLarkCardNotification(successCard, {
            receiveId: targetReceiveId,
            receiveIdType: targetReceiveIdType,
          }).catch(console.error);
        }

        return {
          replyText: successText,
          toolsUsed: ["executeConfirmNegativeKeyword"],
          larkSent: true,
          larkDetail: { status: "confirmed_negative", keyword: pending.keyword },
          actionLinks: [{ label: "🎯 Xem Negative Keywords", url: "https://ncehub.net/?view=ppc&section=negative_keyword" }],
        };
      } else if (isCancel) {
        await clearPendingAction(options.sessionId);

        const cancelText = `❌ ĐÃ HỦY THAO TÁC\nĐã hủy yêu cầu phủ định từ khóa **${pending.keyword}** của store **${pending.storeName}**. Không có thay đổi nào được ghi vào hệ thống.`;
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
  const model = (process.env.LARK_AGENT_MODEL || "gemini-3.8-flash").trim();

  if (!apiKey) {
    throw new Error("Chưa cấu hình LARK_AGENT_KEY trong file .env");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = `Bạn là AI Agent chuyên trách Kế Toán & Vận Hành Amazon FBA trên Lark Bot.
TỰ XƯNG & ĐỊNH DANH: Luôn xưng là "AI Agent" (Tuyệt đối KHÔNG bao giờ nhắc đến tên model hay công nghệ nền tảng).
Hôm nay là: ${todayStr}.
Các store hiện có trong hệ thống: BOZSPACER, FASTPEACE, LIMIMA, MALFIRST, WARMSTOREY.

QUY TẮC BẮT BUỘC:
1. "HỎI GÌ TRẢ LỜI ĐÓ" - TUYỆT ĐỐI KHÔNG TRẢ LỜI BỪA LAN MAN:
   - Người dùng hỏi đúng chỉ số hay nghiệp vụ nào thì CHỈ TRẢ LỜI ĐÚNG phần đó.
   - Ví dụ:
     * Người dùng CHỈ HỎI về Lô hàng (Inbound Shipments) -> CHỈ báo cáo về Inbound Shipments, KHÔNG tự ý đưa doanh thu, Ads hay PnL vào.
     * Người dùng CHỈ HỎI về Doanh thu (Revenue) / Đơn hàng -> CHỈ đưa Revenue & Orders/Units Sold.
     * Người dùng CHỈ HỎI về Hoàn tiền (Refund) -> CHỈ báo cáo Refund Cost & Return Rate.
     * Người dùng CHỈ HỎI về Ads -> CHỈ đưa Ads Spend & ACOS/TACOS.
   - CHỈ KHI người dùng hỏi "báo cáo đầy đủ", "báo cáo tổng quan", "tình hình hoạt động toàn diện" hoặc chủ động hỏi nhiều mục trong một câu thì mới trả lời tổng hợp các phần.

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
   - Khi người dùng hỏi câu ngắn gọn, trả lời đúng trọng tâm trong 3 - 5 dòng, không viết dài dòng thừa thãi.

5. TUYỆT ĐỐI KHÔNG BỊA ĐẶT - KHÔNG CÓ DỮ LIỆU THÌ BÁO KHÔNG CÓ DỮ LIỆU:
   - TUYỆT ĐỐI KHÔNG tự suy đoán, ước lượng hoặc bịa số liệu kế toán. Mọi con số bắt buộc phải lấy từ kết quả thực thi tools.
   - Nếu tools trả về hasData: false hoặc thông báo không tìm thấy:
     * Trả lời thẳng thắn và chính xác: "Chưa có dữ liệu kế toán cho khoảng thời gian này."
     * Nếu store không tồn tại: "Không tìm thấy store trong hệ thống."
     * Nếu không có lô hàng: "Hiện không có lô hàng nào đang vận chuyển."
     * Nếu không có đơn hàng cho SKU: "Không có dữ liệu đơn hàng cho SKU này."
   - Không được tự tiện biến việc "chưa có dữ liệu" thành con số $0 khi ngày đó chưa được đối soát hoặc chưa import.

6. BẮT BUỘC HỎI XÁC NHẬN KHI PHỦ ĐỊNH TỪ KHÓA (NEGATIVE KEYWORDS):
   - Khi người dùng muốn phủ định từ khóa hoặc auto đẩy negative keyword (VD: "Phủ định từ khóa X cho store Y"), BẮT BUỘC gọi tool "requestNegativeKeywordAction".
   - KHI TOOL TRẢ VỀ: Thao tác CHƯA được ghi vào database ngay. AI Agent BẮT BUỘC hiển thị Thẻ Xác Nhận thông báo thông tin chi tiết (Store, Từ khóa, Match Type, Lý do), và hỏi người dùng có xác nhận auto đẩy không.
   - Hướng dẫn người dùng bấm nút [Xác nhận đẩy ngay] bên dưới hoặc nhắn tin "Xác nhận" để đẩy ngay, hoặc "Hủy" để bỏ qua.
   - TUYỆT ĐỐI KHÔNG tự tiện báo "Đã phủ định thành công" ở bước này!`;

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

  // Vòng lặp Function Calling (Tối đa 4 vòng)
  for (let step = 0; step < 4; step++) {
    const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS_SCHEMA,
        tool_choice: "auto",
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

    // Thực thi các tool
    for (const toolCall of assistantMsg.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = toolCall.function.arguments;
      toolsUsed.push(fnName);

      const toolResult = await executeTool(fnName, fnArgs, options.sessionId);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: fnName,
        content: toolResult,
      });
    }
  }

  const lastMsg = messages[messages.length - 1];
  const rawReplyText = lastMsg.role === "assistant" && lastMsg.content ? lastMsg.content : "Không có phản hồi.";
  
  // Chuẩn hóa đồng bộ font chữ (loại bỏ inline code backticks và italics gây lệch font trên Lark)
  let replyText = sanitizeUniformTypography(rawReplyText);

  // Xác định các link đối soát phù hợp dựa trên nội dung câu hỏi và tools được gọi
  const isAwaitingNegativeConfirmation = toolsUsed.includes("requestNegativeKeywordAction");
  const recButtons = resolveContextualReconciliationLinks(options.message, toolsUsed, replyText);

  // Đính kèm link markdown vào cuối text đối với các câu hỏi báo cáo dữ liệu
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
      let cardElements: any[] = [
        {
          tag: "markdown",
          content: replyText,
        },
      ];

      let cardTemplate = "blue";
      let cardTitle = "📊 AI Agent - Accounting & Operations";

      if (isAwaitingNegativeConfirmation && options.sessionId) {
        // Render 2 nút bấm Xác nhận / Hủy cạnh nhau
        cardTemplate = "orange";
        cardTitle = "⚠️ Yêu Cầu Xác Nhận Phủ Định Từ Khóa (PPC)";
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
            ? "AI Agent | Tự động hóa PPC Amazon FBA"
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
