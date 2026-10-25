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
  listSaleKwCandidates,
  requestLaunchSaleKwAction,
  executeConfirmSaleKwLaunch,
} from "./lark-agent-tools";
import {
  listBidRecommendations,
  requestBidAction,
  executeConfirmBidAction,
  getBidQueueStatus,
  getBidOutcomes,
  reviewBidWithAi,
  getTargetBidHistory,
  getSkuInsight,
} from "./lark-ppc-bid-tools";
import {
  getConversationHistory,
  saveConversationTurn,
  getPendingAction,
  clearPendingAction,
  claimPendingAction,
  PendingPpcAction,
} from "./lark-conversation-memory";
import { sendLarkCardNotification, sendLarkTextNotification } from "@/lib/lark-notifications";

const AUTO_BID_TOOLS = new Set([
  "listBidRecommendations",
  "requestBidAction",
  "executeConfirmBidAction",
  "getBidQueueStatus",
  "getBidOutcomes",
  "reviewBidWithAi",
  "getTargetBidHistory",
  "getSkuInsight",
]);
const AUTO_BID_URL = "https://ncehub.net/?view=ppc&section=auto_bid";
const AUTO_BID_HISTORY_URL = "https://ncehub.net/?view=ppc&section=auto_bid&drawer=history";

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

  // 1. PPC Scale KW / Sale KW / Lên Camp
  const isSaleKw = (
    toolsUsed.includes("listSaleKwCandidates") ||
    toolsUsed.includes("requestLaunchSaleKwAction") ||
    toolsUsed.includes("executeConfirmSaleKwLaunch") ||
    /(sale kw|lên camp|tạo camp|scale kw|từ khóa ra đơn|harvest kw)/i.test(query)
  );

  if (isSaleKw) {
    add("🚀 Bảng Quản Lý Scale KW", "https://ncehub.net/?view=ppc&section=sale_kw");
    add("📋 Xem Lịch Sử Auto Upload", "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history");
    return buttons;
  }

  // 1b. PPC Auto Bid (đề xuất bid, hàng đợi, kết quả sau chỉnh bid)
  const isAutoBid = (
    toolsUsed.some((tool) => AUTO_BID_TOOLS.has(tool)) ||
    /(auto bid|giá thầu|chỉnh bid|tăng bid|giảm bid|đề xuất bid)/i.test(query)
  );

  if (isAutoBid) {
    add("🎯 Mở Auto Bid", AUTO_BID_URL);
    add("📋 Xem Lịch Sử Auto Upload", AUTO_BID_HISTORY_URL);
    return buttons;
  }

  // 2. PPC Negative Keywords / Tối ưu Ads / Search Term Candidate
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
    add("📢 Đối soát Chi phí Ads", "https://ncehub.net/?view=accounting&section=financials&subtab=fba");
  }

  // 4. Lợi nhuận / PnL / Net Profit / Gross Profit / Margin
  if (
    /pnl|p&l|lợi nhuận|net profit|gross profit|margin|lãi ròng|lãi gộp/i.test(q)
  ) {
    add("💵 Bảng đối soát P&L", "https://ncehub.net/?view=accounting&section=financials&subtab=fba");
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
    add("📊 Đối soát Revenue", "https://ncehub.net/?view=accounting&section=financials&subtab=fba");
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
      description: "So sánh hiệu quả hoạt động giữa hai chu kỳ thời gian (ví dụ tuần này vs tuần trước, tháng này vs tháng trước) tự động tính chênh lệch tuyệt đối và % tăng giảm. ĐÃ TỰ ĐỘNG CĂN CHỈNH SỐ NGÀY CÙNG KỲ (Like-for-Like / Apple-to-Apple): nếu chu kỳ 2 thực tế mới có N ngày (do ngày gần nhất chưa có dữ liệu) thì chu kỳ 1 tự động được cắt đúng N ngày tương ứng để so sánh công bằng và chính xác.",
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
      description: "Tra cứu danh sách các Search Terms lãng phí tiền (Clicks cao, 0 đơn) CẦN phủ định của một store cụ thể. BẮT BUỘC phải có storeQuery. Nếu người dùng chưa nêu tên store trong câu hỏi và lịch sử hội thoại chưa có, KHÔNG ĐƯỢC tự ý gọi tool hay đoán bừa store, mà PHẢI hỏi lại người dùng muốn tra cứu cho store nào.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "BẮT BUỘC: Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE, MALFIRST, HSOSTORE)." },
          minClicks: { type: "number", description: "Số lượng clicks tối thiểu không ra đơn (mặc định 10)." },
          limit: { type: "number", description: "Số lượng search terms tối đa hiển thị (mặc định 10)." },
        },
        required: ["storeQuery"],
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
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE, MALFIRST, HSOSTORE)." },
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
  {
    type: "function",
    function: {
      name: "listSaleKwCandidates",
      description: "Tra cứu danh sách các Search Terms ra đơn tốt (Sale Keywords: Orders >= 2, ACOS đẹp) để chuẩn bị lên camp mới cho một store cụ thể. BẮT BUỘC phải có storeQuery. Nếu người dùng chưa nêu tên store trong câu hỏi và lịch sử hội thoại chưa có, KHÔNG ĐƯỢC tự ý gọi tool hay đoán bừa store, mà PHẢI hỏi lại người dùng muốn tra cứu cho store nào.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "BẮT BUỘC: Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE, MALFIRST, HSOSTORE)." },
          sku: { type: "string", description: "Mã SKU cần lọc cụ thể (tùy chọn)." },
          minOrders: { type: "number", description: "Số lượng đơn hàng tối thiểu (mặc định 2, tương đương Orders > 2 trên Web UI)." },
          daysWindow: { type: "number", enum: [7, 14, 30, 60, 90], description: "Khung thời gian phân tích: 7, 14, 30 hoặc 60 ngày (mặc định 30 ngày)." },
          limit: { type: "number", description: "Số lượng search terms tối đa hiển thị (mặc định 10, tối đa 30)." },
        },
        required: ["storeQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "requestLaunchSaleKwAction",
      description: "Khởi tạo yêu cầu tạo bộ 3 Campaign Sale KW (Exact, Phrase, Broad) theo chuẩn cấu trúc của team (SKU_SP03_User_Date). Hỗ trợ chọn theo số thứ tự ('itemIndices') từ danh sách vừa tra cứu hoặc truyền danh sách từ khóa ('keywords'). Thao tác này sẽ hiển thị Thẻ Xác Nhận Đơn Giản, Dễ Nhìn kèm nút bấm 'Xác nhận lên camp' trước khi auto upload.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "Tên store (VD: BOZSPACER, LIMIMA, FASTPEACE,...)" },
          itemIndices: {
            type: "array",
            items: { type: "number" },
            description: "Danh sách số thứ tự (STT) từ bảng search terms vừa được gợi ý (ví dụ: [1, 2, 3]).",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Danh sách một hoặc nhiều từ khóa cần lên camp (nếu nhập tay).",
          },
          sku: { type: "string", description: "Mã SKU gán cho chiến dịch (nếu muốn chỉ định rõ)." },
          dailyBudget: { type: "number", description: "Ngân sách hàng ngày cho mỗi chiến dịch (mặc định $5.0)." },
          defaultBid: { type: "number", description: "Default bid ban đầu (mặc định $1.0 hoặc theo CPC trung bình)." },
          userName: { type: "string", description: "Tên người tạo campaign trong quy tắc đặt tên (mặc định 'Loan')." },
          negateInSource: { type: "boolean", description: "Tự động phủ định exact từ khóa này ở campaign nguồn hay không (mặc định false)." },
        },
        required: ["storeQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listBidRecommendations",
      description: "Xem danh sách đề xuất Auto Bid (tăng bid, giảm bid, tạm dừng target) của một store, dữ liệu 30 ngày, giống tab Auto Bid trên web. BẮT BUỘC có storeQuery (nếu chưa rõ store thì hỏi lại). Danh sách được lưu theo STT để duyệt tiếp.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "BẮT BUỘC: Tên store." },
          type: { type: "string", enum: ["ALL", "INCREASE", "DECREASE", "PAUSE"], description: "Lọc loại đề xuất: tăng bid, giảm bid, tạm dừng (mặc định ALL)." },
          sku: { type: "string", description: "Lọc theo SKU (tùy chọn)." },
          campaignType: { type: "string", enum: ["SP03", "SB01", "SB05"], description: "Lọc theo loại campaign (tùy chọn)." },
          limit: { type: "number", description: "Số đề xuất hiển thị (mặc định 10, tối đa 30)." },
        },
        required: ["storeQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "requestBidAction",
      description: "Tạo yêu cầu DUYỆT + AUTO UPLOAD các đề xuất bid theo STT từ danh sách listBidRecommendations vừa xem. Có thể sửa bid từng dòng (bidOverrides) hoặc dùng bid AI đã review (useAiBidFor). Thao tác này CHỈ hiển thị Thẻ Xác Nhận, chưa thực thi.",
      parameters: {
        type: "object",
        properties: {
          itemIndices: { type: "array", items: { type: "number" }, description: "Danh sách STT cần duyệt (VD: [1, 2, 5])." },
          all: { type: "boolean", description: "true nếu người dùng muốn duyệt tất cả đề xuất đang hiển thị." },
          bidOverrides: {
            type: "array",
            items: {
              type: "object",
              properties: { stt: { type: "number" }, bid: { type: "number" } },
              required: ["stt", "bid"],
            },
            description: "Bid tự nhập cho từng STT (VD: 'số 3 đặt bid 0.65' -> [{stt:3, bid:0.65}]).",
          },
          useAiBidFor: { type: "array", items: { type: "number" }, description: "Các STT dùng bid AI đề xuất (phải chạy reviewBidWithAi trước)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reviewBidWithAi",
      description: "Cho AI Reviewer đánh giá một đề xuất bid theo STT trong danh sách vừa xem (so sánh bid rule với bid AI, dựa trên lịch sử kết quả). Mỗi lần chỉ 1 STT.",
      parameters: {
        type: "object",
        properties: { stt: { type: "number", description: "STT đề xuất cần AI review." } },
        required: ["stt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getBidQueueStatus",
      description: "Xem hàng đợi Auto Bid (số thay đổi đang chờ upload, đã áp dụng 7 ngày qua) và 5 job Auto Upload gần nhất (thành công / lỗi / đang chạy).",
      parameters: {
        type: "object",
        properties: { storeQuery: { type: "string", description: "Tên store hoặc để trống để xem tất cả." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getBidOutcomes",
      description: "Xem kết quả sau khi chỉnh bid / auto upload (tốt / xấu, tỷ lệ thắng, hiệu quả $, ACOS trước-sau). Xếp hạng được target / campaign / SKU tốt nhất hoặc xấu nhất sau khi chỉnh. BẮT BUỘC có storeQuery.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "BẮT BUỘC: Tên store." },
          days: { type: "number", description: "Xét các lần chỉnh bid trong N ngày qua (mặc định 60)." },
          label: { type: "string", enum: ["ALL", "POSITIVE", "NEUTRAL", "NEGATIVE"], description: "Lọc theo kết quả (VD: NEGATIVE để xem lần chỉnh bị xấu)." },
          groupBy: { type: "string", enum: ["ACTION", "TARGET", "CAMPAIGN", "SKU"], description: "Gom theo: từng lần chỉnh (mặc định), target, campaign hoặc SKU." },
          rank: { type: "string", enum: ["RECENT", "BEST", "WORST"], description: "Sắp xếp: gần nhất (mặc định), tốt nhất hoặc xấu nhất theo hiệu quả $." },
          sku: { type: "string", description: "Lọc theo SKU (tùy chọn)." },
          limit: { type: "number", description: "Số dòng chi tiết (mặc định 10)." },
        },
        required: ["storeQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSkuInsight",
      description: "Xem tình hình một SKU: số liệu hiện tại (Revenue, Units, Ads, ACOS, TACOS, Profit) so với kỳ trước, xu hướng 4 tuần, ACOS ads so với hòa vốn, search term đốt tiền / ra đơn, đề xuất bid đang có và gợi ý nên làm gì. BẮT BUỘC có storeQuery và sku.",
      parameters: {
        type: "object",
        properties: {
          storeQuery: { type: "string", description: "BẮT BUỘC: Tên store." },
          sku: { type: "string", description: "BẮT BUỘC: Mã SKU." },
          days: { type: "number", description: "Độ dài kỳ so sánh (mặc định 14 ngày, từ 7 đến 30)." },
        },
        required: ["storeQuery", "sku"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTargetBidHistory",
      description: "Xem lịch sử chỉnh bid của một target (theo STT trong danh sách đề xuất vừa xem, hoặc theo keyword / SKU) kèm kết quả từng lần.",
      parameters: {
        type: "object",
        properties: {
          stt: { type: "number", description: "STT trong danh sách đề xuất vừa xem (ưu tiên)." },
          storeQuery: { type: "string", description: "Tên store (bắt buộc nếu không dùng STT)." },
          keyword: { type: "string", description: "Keyword / target cần xem." },
          sku: { type: "string", description: "SKU cần xem." },
          limit: { type: "number", description: "Số lần chỉnh gần nhất (mặc định 10)." },
        },
      },
    },
  },
];

const SESSION_STATE_TOOLS = new Set([
  "listNegativeCandidates",
  "requestNegativeKeywordAction",
  "listSaleKwCandidates",
  "requestLaunchSaleKwAction",
  "listBidRecommendations",
  "requestBidAction",
  "reviewBidWithAi",
  "getTargetBidHistory",
  "getSkuInsight",
]);

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
      case "listSaleKwCandidates":
        return JSON.stringify(await listSaleKwCandidates(args, sessionId));
      case "requestLaunchSaleKwAction":
        return JSON.stringify(await requestLaunchSaleKwAction(args, sessionId));
      case "listBidRecommendations":
        return JSON.stringify(await listBidRecommendations(args, sessionId));
      case "requestBidAction":
        return JSON.stringify(await requestBidAction(args, sessionId));
      case "reviewBidWithAi":
        return JSON.stringify(await reviewBidWithAi(args, sessionId));
      case "getBidQueueStatus":
        return JSON.stringify(await getBidQueueStatus(args));
      case "getBidOutcomes":
        return JSON.stringify(await getBidOutcomes(args));
      case "getTargetBidHistory":
        return JSON.stringify(await getTargetBidHistory(args, sessionId));
      case "getSkuInsight":
        return JSON.stringify(await getSkuInsight(args, sessionId));
      default:
        return JSON.stringify({ error: `Không tìm thấy công cụ: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || "Lỗi thực thi công cụ." });
  }
}

function linkButton(label: string, url: string, type: "primary" | "default") {
  return {
    tag: "button",
    text: { tag: "plain_text", content: label },
    type,
    width: "fill",
    multi_url: { url, pc_url: url, android_url: url, ios_url: url },
  };
}

function twoColumns(left: Record<string, unknown>, right: Record<string, unknown>) {
  return {
    tag: "column_set",
    flex_mode: "bisect",
    background_style: "default",
    columns: [left, right].map((element) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [element],
    })),
  };
}

/** Hai nút Xác nhận / Hủy; webhook đổi thành tin nhắn "Xác nhận" / "Hủy" của đúng người hỏi. */
function confirmButtons(confirmLabel: string, sessionId: string) {
  return twoColumns(
    {
      tag: "button",
      text: { tag: "plain_text", content: confirmLabel },
      type: "primary",
      width: "fill",
      value: { action: "CONFIRM_ACTION", sessionId },
    },
    {
      tag: "button",
      text: { tag: "plain_text", content: "❌ Hủy bỏ" },
      type: "danger",
      width: "fill",
      value: { action: "CANCEL_ACTION", sessionId },
    },
  );
}

async function confirmAutoBid(
  pending: PendingPpcAction,
  options: RunAgentOptions,
  targetReceiveId: string,
  targetReceiveIdType: string,
): Promise<AgentResult> {
  const result = await executeConfirmBidAction(pending);
  await clearPendingAction(options.sessionId!);

  const items = pending.bidItems || [];
  const lines = items
    .map((item, idx) => {
      const rec = item.recommendation;
      const change = item.finalBid === null
        ? "⏸️ Tạm dừng"
        : `$${Number(rec.currentBid || 0).toFixed(2)} → $${item.finalBid.toFixed(2)}`;
      return `${idx + 1}. **${rec.keyword}** (SKU: ${rec.sku || "N/A"}) • ${change}`;
    })
    .join("\n");

  const replyText = result.uploaded
    ? `🟢 **ĐÃ DUYỆT VÀ XẾP HÀNG AUTO UPLOAD BID!**
- **Store:** ${pending.storeName}
- **Số thay đổi:** ${result.actionCount}
- **File Bulksheet:** ${result.fileName}

**Danh sách thay đổi:**
${lines}

Mac mini worker sẽ đẩy file lên Amazon Ads. Kết quả upload sẽ được báo lại trên Lark.`
    : `🟠 **ĐÃ DUYỆT VÀO HÀNG ĐỢI NHƯNG CHƯA UPLOAD ĐƯỢC**
- **Store:** ${pending.storeName}
- **Số thay đổi trong hàng đợi:** ${result.actionCount}
- **Lỗi:** ${result.error}

**Danh sách thay đổi:**
${lines}

Các thay đổi vẫn nằm trong hàng đợi Auto Bid trên web, có thể upload lại ở đó.`;

  await saveConversationTurn(options.sessionId!, options.message, replyText);

  if (options.sendToLark && targetReceiveId) {
    const card = {
      schema: "2.0",
      config: { width_mode: "fill" },
      header: {
        template: result.uploaded ? "green" : "orange",
        title: {
          tag: "plain_text",
          content: result.uploaded ? "🟢 Auto Bid Đã Xếp Hàng Upload" : "🟠 Auto Bid Chưa Upload Được",
        },
      },
      body: {
        elements: [
          { tag: "markdown", content: replyText },
          twoColumns(
            linkButton("🎯 Mở Auto Bid", AUTO_BID_URL, "primary"),
            linkButton("📋 Xem Lịch Sử Auto Upload", AUTO_BID_HISTORY_URL, "default"),
          ),
          { tag: "hr" },
          { tag: "markdown", content: "AI Agent | Tự động hóa PPC Amazon FBA" },
        ],
      },
    };
    await sendLarkCardNotification(card, {
      receiveId: targetReceiveId,
      receiveIdType: targetReceiveIdType,
      replyToMessageId: options.replyToMessageId,
    }).catch(console.error);
  }

  return {
    replyText,
    toolsUsed: ["executeConfirmBidAction"],
    larkSent: true,
    larkDetail: { status: result.uploaded ? "confirmed_auto_bid" : "auto_bid_upload_failed", count: result.actionCount },
    actionLinks: [
      { label: "🎯 Mở Auto Bid", url: AUTO_BID_URL },
      { label: "📋 Xem Lịch Sử Auto Upload", url: AUTO_BID_HISTORY_URL },
    ],
  };
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
      // Chỉ khớp khi CẢ tin nhắn là câu xác nhận / hủy ngắn: "duyệt số 3" hay "không, lấy số 2" là yêu cầu mới.
      const tail = String.raw`(?:\s+(?:nhé|nhe|nha|đi|di|luôn|luon|ạ|thôi|thoi|auto upload))*[\s.!]*$`;
      const isConfirm = new RegExp(String.raw`^(?:xác nhận|xac nhan|đồng ý|dong y|ok|đẩy đi|day di|yes|y|confirm|duyệt|duyet|tiến hành|tien hanh)${tail}`, "i").test(trimmed);
      const isCancel = new RegExp(String.raw`^(?:hủy|huy|hủy bỏ|huy bo|cancel|bỏ qua|bo qua|không|khong|stop|dừng|dung)${tail}`, "i").test(trimmed);

      // Bấm nút 2 lần / vừa bấm vừa gõ: chỉ lần đầu giành được thao tác chờ mới được thực thi.
      if ((isConfirm || isCancel) && !(await claimPendingAction(options.sessionId))) {
        return {
          replyText: "Yêu cầu này đã được xử lý trước đó.",
          toolsUsed: [],
          larkSent: false,
          larkDetail: { status: "pending_already_handled" },
        };
      }

      if (isConfirm) {
        if (pending.action === "AUTO_BID") {
          return confirmAutoBid(pending, options, targetReceiveId, targetReceiveIdType);
        }

        if (pending.action === "LAUNCH_SALE_KW") {
          const execResult = await executeConfirmSaleKwLaunch(pending);
          await clearPendingAction(options.sessionId);

          const triadLines = (pending.campaignTriads || [])
            .map((t, idx) => `${idx + 1}. **SKU: ${t.sku}** (${t.keywordsCount} từ khóa)\n   • Exact: \`${t.exact}\`\n   • Phrase: \`${t.phrase}\`\n   • Broad: \`${t.broad}\``)
            .join("\n");

          const successText = `🟢 **ĐÃ TẠO VÀ XẾP HÀNG LÊN CAMP SALE KW THÀNH CÔNG!**
- **Store:** ${pending.storeName}
- **Tổng số chiến dịch:** ${execResult.campaignsCount} campaigns
- **File Bulksheet:** ${execResult.fileName}
- **Ngân sách:** $${pending.dailyBudget}/ngày mỗi camp (Default bid: $${pending.defaultBid})

**Danh sách bộ 3 chiến dịch được khởi tạo:**
${triadLines}

Hệ thống đã lưu vào Scale KW Registry và xếp hàng Auto Upload qua Mac mini worker đẩy lên Amazon Advertising Console.`;

          await saveConversationTurn(options.sessionId, options.message, successText);

          if (options.sendToLark && targetReceiveId) {
            const successCard = {
              schema: "2.0",
              config: { width_mode: "fill" },
              header: {
                template: "green",
                title: { tag: "plain_text", content: "🟢 Auto Upload Sale KW Thành Công" },
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
                            text: { tag: "plain_text", content: "🚀 Xem Bảng Scale KW" },
                            type: "primary",
                            width: "fill",
                            multi_url: {
                              url: "https://ncehub.net/?view=ppc&section=sale_kw",
                              pc_url: "https://ncehub.net/?view=ppc&section=sale_kw",
                              android_url: "https://ncehub.net/?view=ppc&section=sale_kw",
                              ios_url: "https://ncehub.net/?view=ppc&section=sale_kw",
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
                              url: "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history",
                              pc_url: "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history",
                              android_url: "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history",
                              ios_url: "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history",
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
            toolsUsed: ["executeConfirmSaleKwLaunch"],
            larkSent: true,
            larkDetail: { status: "confirmed_sale_kw", count: execResult.campaignsCount },
            actionLinks: [
              { label: "🚀 Xem Bảng Scale KW", url: "https://ncehub.net/?view=ppc&section=sale_kw" },
              { label: "📋 Xem Lịch Sử Auto Upload", url: "https://ncehub.net/?view=ppc&section=sale_kw&drawer=history" },
            ],
          };
        }

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

        const cancelSubject = pending.action === "LAUNCH_SALE_KW"
          ? "lên Campaign Sale KW"
          : pending.action === "AUTO_BID"
          ? "chỉnh bid (Auto Bid)"
          : "phủ định từ khóa";
        const cancelText = `❌ **ĐÃ HỦY THAO TÁC**\nĐã hủy yêu cầu ${cancelSubject} của store **${pending.storeName}**. Không có thay đổi nào được ghi vào hệ thống.`;
        await saveConversationTurn(options.sessionId, options.message, cancelText);

        if (options.sendToLark && targetReceiveId) {
          const cancelCard = {
            schema: "2.0",
            config: { width_mode: "fill" },
            header: {
              template: "grey",
              title: {
                tag: "plain_text",
                content: pending.action === "LAUNCH_SALE_KW"
                  ? "❌ Đã Hủy Lên Camp Sale KW"
                  : pending.action === "AUTO_BID"
                  ? "❌ Đã Hủy Auto Bid"
                  : "❌ Đã Hủy Thao Tác Phủ Định",
              },
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
          larkDetail: {
            status: pending.action === "LAUNCH_SALE_KW"
              ? "cancelled_sale_kw"
              : pending.action === "AUTO_BID"
              ? "cancelled_auto_bid"
              : "cancelled_negative",
          },
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
0. BẮT BUỘC PHẢI BIẾT RÕ STORE (TRỪ CÂU HỎI SO SÁNH / TỔNG HỢP CÁC STORE):
   - Khi người dùng hỏi về PPC (Sale KW, Negative Keywords, Search Terms, Lên Camp) hoặc Kế toán / Doanh thu / Chi phí của một store riêng lẻ:
     * Nếu trong câu hỏi HOẶC trong lịch sử hội thoại gần đây ĐÃ XÁC ĐỊNH RÕ tên store -> Sử dụng đúng store đó.
     * NẾU CẢ CÂU HỎI VÀ LỊCH SỬ HỘI THOẠI CHƯA NHẮC ĐẾN STORE NÀO:
       + TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý chọn bừa một store!
       + TUYỆT ĐỐI KHÔNG ĐƯỢC gom chung tất cả các store hoặc trả về danh sách tổng hợp!
       + BẮT BUỘC PHẢI HỎI LẠI NGƯỜI DÙNG: "Bạn muốn kiểm tra cho store nào? Hệ thống hiện có: BOZSPACER, LIMIMA, FASTPEACE, MALFIRST, WARMSTOREY."
   - Khi người dùng hỏi so sánh / xếp hạng giữa các store (VD: "store nào bán tốt nhất", "store nào profit tốt nhất", "xếp hạng doanh thu"):
     * Gọi tool getDailyMetricsSummary mà KHÔNG truyền storeQuery (để trống storeQuery) để hệ thống tự động tổng hợp và trả về bảng xếp hạng chuẩn (rankingByProfit, rankingByNetProfit, rankingByRevenue, topStore).
     * BẮT BUỘC SẮP XẾP DANH SÁCH THEO THỨ TỰ TỪ CAO XUỐNG THẤP (GIẢM DẦN theo đúng chỉ số được hỏi).
       Số 1 luôn là store cao nhất, số 2 là cao tiếp theo... TUYỆT ĐỐI KHÔNG BAO GIỜ để số 1 có giá trị nhỏ hơn số 2!
     * PHÂN BIỆT RÕ RÀNG VÀ TÁCH BIỆT GIỮA "PROFIT" VÀ "NET PROFIT":
       + Trên bảng đối soát FBA Daily của Web UI có 2 cột riêng biệt:
         - "Profit": Lợi nhuận trước chi phí dịch vụ cố định (Revenue - Ads - Basecost - Amazon Fee - Thuế - Refund).
         - "Net Profit": Lợi nhuận ròng sau khi trừ chi phí dịch vụ kho/quản trị.
       + NGUYÊN TẮC: Hỏi PROFIT thì CHỈ TRẢ LỜI DUY NHẤT PROFIT. Hỏi NET PROFIT thì MỚI TRẢ LỜI NET PROFIT. Tuyệt đối không tự ý kèm cả hai khi người dùng chỉ hỏi một cái!
       + Ví dụ khi người dùng hỏi "Profit" (hoặc "lợi nhuận"):
         💰 Bảng xếp hạng Profit tháng 10/2026 (01/10 - 23/10/2026, chốt đến ngày 23/10):
         1. MALFIRST: $19,008
         2. BOZSPACER: $18,749
         3. LIMIMA: $8,234
         4. WARMSTOREY: $2,901
         5. FASTPEACE: $2,054
         🏆 Store có Profit tốt nhất là MALFIRST với $19,008.
       + Ví dụ khi người dùng hỏi "Net Profit" (hoặc "lợi nhuận ròng", "net"):
         💰 Bảng xếp hạng Net Profit tháng 10/2026 (01/10 - 23/10/2026, chốt đến ngày 23/10):
         1. MALFIRST: $16,865
         2. BOZSPACER: $16,606
         3. LIMIMA: $6,411
         4. WARMSTOREY: $758
         5. FASTPEACE: -$89
         🏆 Store có Net Profit tốt nhất là MALFIRST với $16,865.
     * MỐC THỜI GIAN & DỮ LIỆU THỰC TẾ (FBA DAILY):
       + Dữ liệu kế toán FBA trên sàn Amazon phụ thuộc vào tiến độ đồng bộ và đối soát.
       + BẮT BUỘC ĐỌC KỸ actualEndDate, actualDays, latestAvailableDate và periodNote từ kết quả tool trả về:
         - Nếu kết quả tool trả về actualEndDate: "2026-10-23" và actualDays: 23 (dù endDate người dùng hỏi hoặc mặc định là 24/10 hay 25/10), BẮT BUỘC PHẢI BÁO CHÍNH XÁC:
           "Dữ liệu tháng 10/2026 (từ 01/10 đến 23/10/2026 - 23 ngày, do ngày 24/10 chưa có dữ liệu đối soát trên hệ thống)..."
         - TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý gán mốc thời gian là 24/10 khi trong dữ liệu DB thực tế chưa có ngày 24/10!

1. NGUYÊN TẮC TUYỆT ĐỐI "HỎI GÌ TRẢ LỜI ĐÓ - KHÔNG TRẢ LỜI THỪA/KÈM CHỈ SỐ KHÁC":
   - Khi người dùng hỏi đích danh 1 chỉ số cụ thể:
     * Người dùng hỏi "ACOS" -> CHỈ TRẢ LỜI DUY NHẤT CON SỐ ACOS (kèm thời gian). TUYỆT ĐỐI KHÔNG tự tiện đưa thêm TACOS hay Ads Spend vào!
       Ví dụ đúng: "ACOS của store LIMIMA ngày 23/10/2026 là **95.2%**."
     * Người dùng hỏi "TACOS" -> CHỈ TRẢ LỜI DUY NHẤT TACOS.
     * Người dùng hỏi "Ads Spend" (hoặc "chi phí ads", "tiền ads") -> CHỈ TRẢ LỜI Ads Spend, KHÔNG tự đưa ACOS/TACOS.
     * Người dùng hỏi "Doanh thu" (Revenue) -> CHỈ TRẢ LỜI Revenue, KHÔNG tự kèm Orders hay Profit.
     * Người dùng hỏi "Đơn hàng" (Orders) -> CHỈ TRẢ LỜI Orders / Units Sold.
     * Người dùng hỏi "Profit" (hoặc "lợi nhuận") -> CHỈ TRẢ LỜI DUY NHẤT con số Profit. TUYỆT ĐỐI KHÔNG đưa thêm Net Profit.
     * Người dùng hỏi "Net Profit" (hoặc "lợi nhuận ròng", "net") -> CHỈ TRẢ LỜI DUY NHẤT con số Net Profit.
     * Người dùng hỏi "Lô hàng" (Inbound Shipments) -> CHỈ báo cáo về Inbound Shipments.
   - CHỈ trả lời cụm nhiều chỉ số khi:
     * Người dùng hỏi bao quát: "chỉ số ads", "tình hình ads" -> Mới đưa cụm (Ads Spend, ACOS, TACOS).
     * Người dùng hỏi "báo cáo đầy đủ", "báo cáo tổng quan", "tổng kết", hoặc người dùng chủ động liệt kê nhiều chỉ số trong câu hỏi.
   - Định dạng trả lời cho câu hỏi 1 chỉ số:
     * Trả lời thẳng thắn, trực diện trong 1 dòng ngắn gọn. TUYỆT ĐỐI KHÔNG vẽ danh sách gạch đầu dòng nhiều mục thừa thãi!

2. BẮT BUỘC LUÔN NÊU RÕ MỐC THỜI GIAN KHI BÁO CÁO BẤT KỲ SỐ LIỆU NÀO:
   - TUYỆT ĐỐI KHÔNG BAO GIỜ đưa ra con số trần trụi mà không gắn với mốc thời gian cụ thể (VD: CẤM chỉ ghi trơ trọi "Revenue: $76,561 (Store: BOZSPACER)").
   - Mọi câu trả lời về chỉ số (Revenue, Orders, Ads Spend, ACOS, Net Profit, Sale KW, v.v.) BẮT BUỘC phải kèm mốc thời gian rõ ràng:
     * Nếu là theo ngày: "Ngày [DD/MM/YYYY], ..." (VD: "Ngày 23/10/2026, Revenue của store LIMIMA là **$4,520**.")
     * Nếu là hôm nay: "Hôm nay ([DD/MM/YYYY]), ..."
     * Nếu là hôm qua: "Hôm qua ([DD/MM/YYYY]), ..."
     * Nếu là khoảng thời gian (khoảng ngày, tháng này, 7 ngày, 30 ngày):
       "Trong tháng 10/2026 (từ 01/10 đến 23/10/2026, 23 ngày), store bán tốt nhất là **BOZSPACER** với 💰 **Revenue:** $76,561."
     * Nếu là Sale KW / Negative KW: "Trong 30 ngày qua (cửa sổ 30D), store LIMIMA có 48 search terms tiềm năng..."

3. TOÀN BỘ CHỈ SỐ KẾ TOÁN DÙNG TIẾNG ANH CHUẨN:
   - Doanh thu: "Revenue"
   - Số đơn hàng: "Orders"
   - Số lượng bán: "Units Sold"
   - Chi phí quảng cáo: "Ads Spend" (hoặc "Ads Fee")
   - Chi phí hoàn tiền / Trả hàng: "Refund Cost" (hoặc "Return Cost")
   - Phí sàn Amazon: "Amazon Fees" (hoặc "FBA Fees")
   - Lợi nhuận: "Profit" (chưa trừ fixed cost)
   - Lợi nhuận ròng: "Net Profit" (đã trừ fixed cost)
   - Tỷ suất lợi nhuận: "Profit Margin" (hoặc "Margin")
   - Chỉ số quảng cáo: "ACOS", "TACOS", "ROI"
   - Lô hàng đang chuyển kho: "Inbound Shipments" (Status: "En Route", "Receiving", "Received")
   - Giá vốn: "Basecost"

4. ĐỒNG BỘ FONT CHỮ TUYỆT ĐỐI (TRÁNH LỆCH FONT TRÊN LARK):
   - TUYỆT ĐỐI KHÔNG dùng dấu backtick (\`) để bọc mã SKU, mã Shipment hay tên store. Hãy viết chữ in hoa thông thường (VD: FBA19S870Z0D, GOTT2906V03, BOZSPACER).
   - TUYỆT ĐỐI KHÔNG dùng chữ nghiêng (*) hoặc (_) cho tên sản phẩm, mã SKU.
   - Toàn bộ nội dung trả lời phải đồng bộ cùng một kiểu font chữ thường, chỉ dùng in đậm (**) cho tiêu đề và tên chỉ số.

5. TRẢ LỜI NGẮN GỌN, ĐẸP, ĐỒNG BỘ FORMAT:
   - Dùng icon trực quan tương ứng: 📊 Report, 💰 Revenue, 📦 Orders / Units Sold, 📢 Ads Spend, 🔄 Refund Cost, 💵 Profit / Net Profit, 🚚 Inbound Shipments.
   - Dùng chỉ báo màu sắc khi so sánh: 🟢 (Tốt / Tăng Profit / Giảm Chi Phí), 🔴 (Xấu / Giảm Profit / Tăng Refund), 🔺 (Tăng), 🔻 (Giảm), ⚪ (Đi ngang / thay đổi không đáng kể).
   - Số tiền luôn định dạng có dấu phẩy và ký hiệu $: VD: $42,500. Tỷ lệ % có 1 chữ số thập phân: VD: 24.5%.
   - TUYỆT ĐỐI KHÔNG viết dài dòng thừa thãi. Hỏi 1 chỉ số -> Trả lời 1 câu trực diện kèm thời gian. Hỏi tổng hợp -> 3 - 5 dòng ngắn gọn.

6. TUYỆT ĐỐI KHÔNG BỊA ĐẶT - KHÔNG CÓ DỮ LIỆU THÌ BÁO KHÔNG CÓ DỮ LIỆU:
   - TUYỆT ĐỐI KHÔNG tự suy đoán, ước lượng hoặc bịa số liệu kế toán. Mọi con số bắt buộc phải lấy từ kết quả thực thi tools.
   - Nếu tools trả về hasData: false hoặc thông báo không tìm thấy:
     * Trả lời thẳng thắn và chính xác: "Chưa có dữ liệu kế toán cho khoảng thời gian này."
     * Nếu store không tồn tại: "Không tìm thấy store trong hệ thống."
     * Nếu không có lô hàng: "Hiện không có lô hàng nào đang vận chuyển."
     * Nếu không có đơn hàng cho SKU: "Không có dữ liệu đơn hàng cho SKU này."
   - Không được tự tiện biến việc "chưa có dữ liệu" thành con số $0 khi ngày đó chưa được đối soát hoặc chưa import.

7. QUY TRÌNH TRA CỨU & PHỦ ĐỊNH TỪ KHÓA (NEGATIVE KEYWORDS):
   - KHI NGƯỜI DÙNG HỎI DANH SÁCH TỪ KHÓA CẦN PHỦ ĐỊNH / LÃNG PHÍ CLICKS / ĐỐT TIỀN:
     * Nếu hỏi danh sách từ khóa ĐANG phủ định trong Hub -> Gọi tool "listNegativeKeywords".
     * Nếu hỏi danh sách từ khóa CẦN phủ định / lãng phí -> Gọi tool "listNegativeCandidates" (mặc định lấy 10 từ khóa lãng phí nhất để người dùng lựa chọn, hoặc lấy số lượng theo người dùng yêu cầu).
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
     * TUYỆT ĐỐI KHÔNG tự tiện báo "Đã phủ định thành công" ở bước này!

8. QUY TRÌNH TRA CỨU & LÊN CAMPAIGN TỪ KHÓA HIỆU QUẢ (SALE KW / SCALE KW):
   - KHI NGƯỜI DÙNG HỎI DANH SÁCH TỪ KHÓA RA ĐƠN / TỪ KHÓA HIỆU QUẢ / SALE KW / CẦN SCALE:
     * BẮT BUỘC xác định Store trước (theo Rule 0).
     * Gọi tool "listSaleKwCandidates" (mặc định lấy 10 từ khóa hiệu quả nhất có orders >= 2, hoặc lấy theo số lượng người dùng yêu cầu).
     * Báo rõ tổng số từ khóa tiềm năng của store (ví dụ: "Tìm thấy tổng cộng 48 search terms tiềm năng cho store LIMIMA. Dưới đây là top 10 từ khóa hiệu quả nhất:").
     * CÁCH TRÌNH BÀY DANH SÁCH TỪ KHÓA HIỆU QUẢ (GỌN GÀNG, SÚC TÍCH):
       - TUYỆT ĐỐI KHÔNG dùng bảng ngang nhiều cột làm tràn giao diện.
       - Trình bày dạng DANH SÁCH ĐÁNH SỐ (1, 2, 3...) theo mẫu sau:
         [STT]. **[Search Term]** (SKU: [SKU]) - [Tên Store]
         • Orders: [N] đơn | Doanh số: $[Sales] | Chi tiêu: $[Spend] | ACOS: [ACOS]%
       - Phía dưới danh sách có lời nhắc ngắn gọn:
         "💡 Hướng dẫn tiếp theo:
         Bạn có thể nhắn số thứ tự (ví dụ: 'Lên camp từ số 1, 2' hoặc 'Lên camp tất cả 10 từ này') để AI Agent tạo bộ 3 chiến dịch (Exact, Phrase, Broad) cho từng SKU. Nếu muốn xem thêm, bạn có thể nhắn 'xem thêm 10 từ nữa'."
   - KHI NGƯỜI DÙNG YÊU CẦU LÊN CAMP / SCALE KW (THEO STT, TÊN TỪ KHÓA, HOẶC TẤT CẢ):
     * BẮT BUỘC gọi tool "requestLaunchSaleKwAction".
     * KHI TOOL TRẢ VỀ: Thao tác CHƯA được ghi vào hệ thống ngay. AI Agent BẮT BUỘC hiển thị Thẻ Xác Nhận ĐƠN GIẢN, DỄ NHÌN với thông tin:
       - Store: [Tên Store]
       - Tổng số SKU & chiến dịch triad sẽ tạo (Exact, Phrase, Broad)
       - Ngân sách hàng ngày ($/ngày mỗi camp) & Default Bid ($)
       - Danh sách từ khóa và SKU tương ứng
       - Hướng dẫn bấm nút [🚀 Xác nhận Lên Camp] hoặc nhắn "Xác nhận", hoặc "Hủy" để bỏ qua.
     * TUYỆT ĐỐI KHÔNG tự tiện báo "Đã lên camp thành công" ở bước này!

9. QUY TẮC SO SÁNH CHU KỲ (LIKE-FOR-LIKE / APPLE-TO-APPLE):
   - KHI SO SÁNH HAI CHU KỲ (VD: Tháng này vs Tháng trước, Tuần này vs Tuần trước):
     * BẮT BUỘC SỐ NGÀY ĐỐI SOÁT PHẢI BẰNG NHAU (LIKE-FOR-LIKE).
     * Ví dụ: Tháng này (tháng 10) thực tế trong DB mới có dữ liệu 23 ngày (01/10 - 23/10/2026), thì khi so sánh với tháng trước (tháng 9), BẮT BUỘC CHỈ ĐƯỢC SO VỚI ĐÚNG 23 NGÀY CỦA THÁNG 9 (01/09 - 23/09/2026).
     * TUYỆT ĐỐI CẤM lấy 23 ngày của tháng này đem so với 24 ngày hay cả tháng của tháng trước, vì điều đó làm sai lệch hoàn toàn kết quả phân tích tăng/giảm!
     * Luôn gọi tool comparePerformancePeriods - tool này đã được tích hợp cơ chế tự động căn chỉnh cùng kỳ đúng số ngày.
     * Khi trình bày kết quả so sánh, BẮT BUỘC nêu rõ:
       "So sánh hiệu quả hoạt động của store [Store] giữa tháng này (01/10 - 23/10/2026) và cùng kỳ tháng trước (01/09 - 23/09/2026, cùng 23 ngày do ngày 24/10 chưa có dữ liệu):"
     * Phân tích điểm chú ý dựa trên số liệu cùng kỳ đã căn chỉnh chính xác (nếu lợi nhuận tăng thì nói tăng, doanh thu đi ngang thì nói đi ngang, tuyệt đối không đưa ra kết luận sai lệch do so sánh thiếu ngày).

9. QUY TRÌNH AUTO BID (ĐỀ XUẤT CHỈNH GIÁ THẦU):
   - BẮT BUỘC xác định Store trước (theo Rule 0) cho listBidRecommendations và getBidOutcomes.
   - "đề xuất bid", "auto bid", "cần tăng/giảm bid", "target nào cần tạm dừng" -> gọi "listBidRecommendations" (lọc type INCREASE / DECREASE / PAUSE nếu người dùng nói rõ).
   - "duyệt số 1, 2", "duyệt tất cả", "số 3 đặt bid 0.65", "duyệt số 2 dùng bid AI" -> gọi "requestBidAction" (itemIndices / all / bidOverrides / useAiBidFor).
     * Tool CHỈ tạo Thẻ Xác Nhận. Hiển thị ngắn gọn: Store, tổng số thay đổi (tăng / giảm / tạm dừng) và từng dòng "$cũ → $mới".
     * Nhắc người dùng bấm [✅ Xác nhận Auto Upload] hoặc nhắn "Xác nhận", hoặc "Hủy".
     * TUYỆT ĐỐI KHÔNG báo "đã cập nhật bid" ở bước này.
   - "AI review số 2", "AI xem số 2 thế nào" -> gọi "reviewBidWithAi" (mỗi lần 1 STT).
   - "hàng đợi bid", "đang chờ upload", "upload bid xong chưa", "job upload lỗi" -> gọi "getBidQueueStatus".
   - "chỉnh bid có hiệu quả không", "kết quả auto bid / auto upload", "lần chỉnh nào bị xấu" -> gọi "getBidOutcomes".
     * "target nào tốt/xấu nhất sau khi chỉnh" -> groupBy TARGET, rank BEST/WORST.
     * "camp nào tốt/xấu nhất sau khi chỉnh" -> groupBy CAMPAIGN, rank BEST/WORST.
     * "SKU nào chỉnh bid hiệu quả nhất" -> groupBy SKU, rank BEST.
     * "lần chỉnh nào xấu nhất" -> groupBy ACTION, rank WORST.
   - "SKU X thế nào", "tình hình SKU X", "trend SKU X", "SKU X nên làm gì" -> gọi "getSkuInsight" (BẮT BUỘC có store và SKU; thiếu thì hỏi lại). Sau đó người dùng nhắn "duyệt số 1" thì gọi requestBidAction như bình thường.
   - "lịch sử bid của số 3", "keyword X đã chỉnh bid mấy lần" -> gọi "getTargetBidHistory".
   - Trình bày theo đúng "instructions" tool trả về: danh sách đánh số, KHÔNG dùng bảng ngang nhiều cột.`;

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
  // Model đôi khi chép lại khối link từ lịch sử hội thoại; bỏ đi vì bên dưới tự gắn link.
  let replyText = sanitizeUniformTypography(rawReplyText)
    .replace(/\n*🔗 \*\*Link đối soát hệ thống:\*\*[\s\S]*$/, "")
    .trimEnd();
  const cleanReportContent = replyText;

  // Xác định các link đối soát phù hợp dựa trên nội dung câu hỏi và tools được gọi
  const isAwaitingNegativeConfirmation = toolsUsed.includes("requestNegativeKeywordAction");
  const isAwaitingSaleKwConfirmation = toolsUsed.includes("requestLaunchSaleKwAction");
  // Chỉ hiện nút xác nhận khi tool thực sự tạo được thao tác chờ (không lỗi STT / hết hạn).
  const isAwaitingBidConfirmation = Boolean(
    toolsUsed.includes("requestBidAction") &&
    options.sessionId &&
    (await getPendingAction(options.sessionId))?.action === "AUTO_BID"
  );
  const recButtons = resolveContextualReconciliationLinks(options.message, toolsUsed, replyText);

  // Đính kèm link markdown vào cuối text (cho text notification hoặc API response)
  if (!isAwaitingNegativeConfirmation && !isAwaitingSaleKwConfirmation && !isAwaitingBidConfirmation && recButtons.length > 0) {
    const linkStr = recButtons.map((b) => `[${b.label}](${b.url})`).join("  •  ");
    replyText += `\n\n🔗 **Link đối soát hệ thống:**\n${linkStr}`;
  }

  // Lưu lượt trao đổi vào bộ nhớ ngắn hạn (không kèm khối link để model không chép lại)
  if (options.sessionId) {
    await saveConversationTurn(options.sessionId, options.message, cleanReportContent);
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
      } else if (isAwaitingSaleKwConfirmation && options.sessionId) {
        // Hộp thoại xác nhận Lên Camp Sale KW với 2 nút bấm Xác nhận / Hủy
        cardTemplate = "turquoise";
        cardTitle = "🚀 Xác Nhận Lên Camp Sale KW (PPC)";
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
                    content: "🚀 Xác nhận Lên Camp",
                  },
                  type: "primary",
                  width: "fill",
                  value: {
                    action: "CONFIRM_SALE_KW",
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
                    action: "CANCEL_SALE_KW",
                    sessionId: options.sessionId,
                  },
                },
              ],
            },
          ],
        });
      } else if (isAwaitingBidConfirmation && options.sessionId) {
        // Hộp thoại xác nhận Auto Bid: chỉ upload khi người dùng bấm xác nhận
        cardTemplate = "orange";
        cardTitle = "⚠️ Xác Nhận Auto Bid (PPC)";
        cardElements.push(confirmButtons("✅ Xác nhận Auto Upload", options.sessionId));
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
          content:
            isAwaitingNegativeConfirmation || isAwaitingSaleKwConfirmation || isAwaitingBidConfirmation
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
