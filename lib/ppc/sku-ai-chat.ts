import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type { DataScope } from "@/lib/db";
import {
  buildSkuSnapshot,
  loadBidHistory,
  loadSkuRecommendations,
  MIN_CLICKS_FOR_NEGATIVE,
  querySearchTerms,
  recView,
  resolveSkuChatScope,
  type SearchTermFilter,
  type SkuChatScope,
  type SkuRules,
} from "./sku-ai-chat-data";
import {
  addSkuNote,
  appendThreadMessage,
  deleteSkuNote,
  listSkuNotes,
  listThreadMessages,
  type SkuNote,
  type SkuNoteKind,
  type SkuThread,
} from "./sku-ai-chat-memory";
import { buildSkuChatSystemPrompt, type SkuChatGoal } from "./sku-ai-chat-skill";

const MAX_STEPS = 5;
// Quá 45s coi như model đang nghẽn: chuyển sang model dự phòng thay vì thử lại cùng model.
const MODEL_TIMEOUT_MS = 45_000;
const MAX_HISTORY_MESSAGES = 12;
// Đo trên cheapkey (29/10/2026): claude-sonnet-4-6 ra chữ sau 2–4s, gpt-5.4-mini 8–9s ổn định,
// gpt-5.6-terra dao động 20–80s nên không dùng cho chat.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_FALLBACK_MODEL = "gpt-5.4-mini";
const DEFAULT_BASE_URL = "https://cheapkeyai.shop/v1";

export type SkuChatEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; label: string }
  /** Chữ AI đang viết (stream). Bị hủy bởi "tool" (AI đổi ý đi tra thêm) hoặc thay bằng "answer". */
  | { type: "delta"; text: string }
  | { type: "notes"; notes: SkuNote[] }
  | { type: "answer"; text: string; toolsUsed: string[]; model: string }
  | { type: "error"; error: string };

// ---------------- Tools (luôn khóa trong store + SKU đang mở) ----------------

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getSearchTerms",
      description: "Danh sách search term của SKU. filter: 'waste' = nhiều click 0 đơn (đốt tiền), 'converting' = có đơn (ứng viên harvest/Sale KW), 'top_spend' = chi nhiều nhất. Có thể lọc theo một phần tên campaign.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["waste", "converting", "top_spend"] },
          campaignContains: { type: "string", description: "Một phần tên campaign để lọc (tùy chọn)." },
          days: { type: "number", enum: [7, 14, 30], description: "Cửa sổ ngày tính tới ngày report mới nhất, mặc định 30." },
          minClicks: { type: "number", description: "Ngưỡng click tối thiểu cho filter waste (mặc định 15, không cắt mẫu quá nhỏ)." },
          limit: { type: "number", description: "Số dòng, mặc định 15, tối đa 40." },
        },
        required: ["filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCampaignTargets",
      description: "Các target/keyword trong một campaign của SKU (30 ngày): clicks, orders, spend, ACOS, bid hiện tại và đề xuất của rule.",
      parameters: {
        type: "object",
        properties: {
          campaignContains: { type: "string", description: "Một phần tên campaign (bắt buộc)." },
          limit: { type: "number", description: "Số target, mặc định 20, tối đa 50." },
        },
        required: ["campaignContains"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getBidRecommendations",
      description: "Đề xuất bid của rule engine cho SKU (tăng / giảm / tạm dừng), kèm lý do, sắp theo spend.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["ALL", "INCREASE", "DECREASE", "PAUSE"] },
          campaignContains: { type: "string" },
          limit: { type: "number", description: "Mặc định 15, tối đa 40." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getBidHistory",
      description: "Lịch sử chỉnh bid của SKU hoặc của một keyword cụ thể, kèm kết quả (Tốt / Xấu / Trung tính).",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Keyword/target cụ thể (tùy chọn)." },
          limit: { type: "number", description: "Mặc định 10, tối đa 20." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "saveSkuNote",
      description: "Ghi nhớ lâu dài cho SKU (cả team cùng thấy, các lần chat sau AI đọc lại). Chỉ dùng cho thông tin KHÔNG có trong dữ liệu: bối cảnh (sắp tăng giá, đổi listing, hết hàng dự kiến), quyết định đã chốt, kế hoạch kèm mốc thời gian. KHÔNG lưu số liệu có sẵn trong hệ thống.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["FACT", "DECISION", "PLAN"], description: "FACT = bối cảnh, DECISION = quyết định đã chốt, PLAN = kế hoạch có mốc thời gian." },
          note: { type: "string", description: "Một câu ngắn, rõ, có ngày tháng nếu liên quan thời gian." },
        },
        required: ["kind", "note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deleteSkuNote",
      description: "Xóa một ghi nhớ đã lỗi thời hoặc người dùng yêu cầu bỏ (theo id trong danh sách ghi nhớ).",
      parameters: {
        type: "object",
        properties: { noteId: { type: "number" } },
        required: ["noteId"],
      },
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  getSearchTerms: "Đang xem search term",
  getCampaignTargets: "Đang xem target trong campaign",
  getBidRecommendations: "Đang xem đề xuất bid",
  getBidHistory: "Đang xem lịch sử chỉnh bid",
  saveSkuNote: "Đang ghi nhớ",
  deleteSkuNote: "Đang xóa ghi nhớ",
};

function clampLimit(value: unknown, fallback: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function toolGetSearchTerms(ctx: SkuChatScope, args: Record<string, unknown>, rules: SkuRules) {
  return querySearchTerms(ctx, {
    filter: (["waste", "converting", "top_spend"].includes(String(args.filter)) ? args.filter : "top_spend") as SearchTermFilter,
    days: [7, 14, 30].includes(Number(args.days)) ? Number(args.days) : 30,
    campaignContains: text(args.campaignContains),
    minClicks: clampLimit(args.minClicks, MIN_CLICKS_FOR_NEGATIVE, 1000),
    limit: clampLimit(args.limit, 15, 40),
  }, rules);
}

async function toolGetCampaignTargets(ctx: SkuChatScope, args: Record<string, unknown>, rules: SkuRules) {
  const campaign = text(args.campaignContains).toLowerCase();
  if (!campaign) return { error: "Cần campaignContains." };
  const targets = (await loadSkuRecommendations(ctx))
    .filter((r) => (r.campaignName || "").toLowerCase().includes(campaign))
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  return {
    windowDays: 30,
    campaigns: [...new Set(targets.map((r) => r.campaignName))],
    total: targets.length,
    maxBid: rules.maxBid,
    targets: targets.slice(0, clampLimit(args.limit, 20, 50)).map((r) => recView(r, rules)),
  };
}

async function toolGetBidRecommendations(ctx: SkuChatScope, args: Record<string, unknown>, rules: SkuRules) {
  const typeMap: Record<string, string> = { INCREASE: "BID_INCREASE", DECREASE: "BID_DECREASE", PAUSE: "PAUSE_TARGET" };
  const recType = typeMap[String(args.type || "ALL")];
  const campaign = text(args.campaignContains).toLowerCase();
  const recs = (await loadSkuRecommendations(ctx))
    .filter((r) => !recType || r.recType === recType)
    .filter((r) => !campaign || (r.campaignName || "").toLowerCase().includes(campaign))
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  return {
    windowDays: 30,
    total: recs.length,
    maxBid: rules.maxBid,
    items: recs.slice(0, clampLimit(args.limit, 15, 40)).map((r) => recView(r, rules)),
  };
}

interface ToolContext {
  ctx: SkuChatScope;
  thread: SkuThread;
  rules: SkuRules;
  notesChanged: boolean;
}

async function executeTool(tc: ToolContext, name: string, rawArgs: string): Promise<string> {
  try {
    const args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    switch (name) {
      case "getSearchTerms":
        return JSON.stringify(await toolGetSearchTerms(tc.ctx, args, tc.rules));
      case "getCampaignTargets":
        return JSON.stringify(await toolGetCampaignTargets(tc.ctx, args, tc.rules));
      case "getBidRecommendations":
        return JSON.stringify(await toolGetBidRecommendations(tc.ctx, args, tc.rules));
      case "getBidHistory":
        return JSON.stringify(await loadBidHistory(tc.ctx, {
          keyword: text(args.keyword) || undefined,
          limit: clampLimit(args.limit, 10, 20),
        }));
      case "saveSkuNote": {
        const kind = (["FACT", "DECISION", "PLAN"].includes(String(args.kind)) ? args.kind : "FACT") as SkuNoteKind;
        const note = text(args.note).slice(0, 500);
        if (!note) return JSON.stringify({ error: "Ghi nhớ trống." });
        const saved = await addSkuNote(tc.thread, kind, note);
        tc.notesChanged = true;
        return JSON.stringify({ saved: true, id: saved.id });
      }
      case "deleteSkuNote": {
        const deleted = await deleteSkuNote(tc.thread, Number(args.noteId));
        if (deleted) tc.notesChanged = true;
        return JSON.stringify({ deleted });
      }
      default:
        return JSON.stringify({ error: `Không có tool ${name}.` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Lỗi chạy tool." });
  }
}

/** Chỉ dùng chung API key với các tính năng AI khác; model và base URL cấu hình riêng. */
function resolveModelConfig() {
  const apiKey = (process.env.SKU_AI_CHAT_API_KEY
    || process.env.PPC_AI_REVIEWER_API_KEY
    || process.env.CHEAPKEYAI_TEXT_API_KEY
    || process.env.CHEAPKEYAI_API_KEY
    || "").trim();
  const baseURL = (process.env.SKU_AI_CHAT_BASE_URL || DEFAULT_BASE_URL).trim();
  const model = (process.env.SKU_AI_CHAT_MODEL || DEFAULT_MODEL).trim();
  const fallbackModel = (process.env.SKU_AI_CHAT_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL).trim();
  if (!apiKey) throw new Error("Chưa cấu hình API key cho AI chat SKU (SKU_AI_CHAT_API_KEY) trong .env");
  return { apiKey, baseURL, model, fallbackModel };
}

/**
 * Gọi model dạng stream: chữ được đẩy ra ngay qua onText, tool call được ghép lại từ các mảnh.
 */
async function streamCompletion(
  client: OpenAI,
  params: Pick<ChatCompletionCreateParamsBase, "model" | "messages" | "tools" | "tool_choice">,
  signal: AbortSignal | undefined,
  onText: (text: string) => void,
): Promise<{ content: string; toolCalls: ChatCompletionMessageFunctionToolCall[] }> {
  const stream = await client.chat.completions.create({ ...params, stream: true }, { signal });
  let content = "";
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    for (const part of delta.tool_calls || []) {
      const call = (calls[part.index] ||= { id: "", name: "", arguments: "" });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
    }
  }
  return {
    content,
    toolCalls: calls.filter(Boolean).map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

export async function resolveSkuThread(scope: DataScope, storeId: string, sku: string): Promise<SkuThread> {
  const ctx = await resolveSkuChatScope(scope, storeId, sku);
  return { scope, storeId: ctx.storeId, sku: ctx.sku };
}

export async function loadSkuChatState(scope: DataScope, storeId: string, sku: string) {
  const thread = await resolveSkuThread(scope, storeId, sku);
  const [messages, notes] = await Promise.all([listThreadMessages(thread), listSkuNotes(thread)]);
  return { thread, messages, notes };
}

export async function runSkuAiChat(
  input: { scope: DataScope; storeId: string; sku: string; goal: SkuChatGoal; message: string },
  emit: (event: SkuChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { apiKey, baseURL, model: primaryModel, fallbackModel } = resolveModelConfig();
  let model = primaryModel;
  const ctx = await resolveSkuChatScope(input.scope, input.storeId, input.sku);
  const thread: SkuThread = { scope: input.scope, storeId: ctx.storeId, sku: ctx.sku };

  emit({ type: "status", text: "Đang tổng hợp dữ liệu SKU…" });
  const [snapshot, history, notes] = await Promise.all([
    buildSkuSnapshot(ctx),
    listThreadMessages(thread, MAX_HISTORY_MESSAGES),
    listSkuNotes(thread),
  ]);
  // Lưu câu hỏi trước khi gọi AI để không mất nếu AI lỗi giữa chừng.
  await appendThreadMessage(thread, { role: "user", content: input.message, goal: input.goal });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSkuChatSystemPrompt(input.goal, JSON.stringify(snapshot), notes) },
    ...history.map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }) as ChatCompletionMessageParam),
    { role: "user", content: input.message },
  ];

  const client = new OpenAI({ apiKey, baseURL, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 });
  const toolContext: ToolContext = {
    ctx,
    thread,
    rules: {
      breakEvenAcosPct: snapshot.unitEconomics?.breakEvenAcosPct ?? null,
      maxBid: snapshot.unitEconomics?.maxBid ?? null,
      profitBeforeAds: snapshot.unitEconomics?.profitBeforeAds ?? null,
    },
    notesChanged: false,
  };
  const toolsUsed: string[] = [];
  emit({ type: "status", text: "AI đang phân tích…" });

  // Vòng cuối không gửi tools để model buộc phải trả lời.
  for (let step = 0; step < MAX_STEPS; step++) {
    const allowTools = step < MAX_STEPS - 1;
    const call = (useModel: string, onText: (text: string) => void) => streamCompletion(
      client,
      { model: useModel, messages, ...(allowTools ? { tools: TOOLS, tool_choice: "auto" as const } : {}) },
      signal,
      onText,
    );
    let streamed = false;
    let result: Awaited<ReturnType<typeof streamCompletion>>;
    try {
      result = await call(model, (text) => {
        streamed = true;
        emit({ type: "delta", text });
      });
    } catch (error) {
      // Model chính lỗi / nghẽn trước khi kịp viết gì: chuyển hẳn sang model dự phòng cho lượt này.
      if (signal?.aborted || streamed || model === fallbackModel) throw error;
      console.warn(`[SKU AI Chat] ${model} lỗi, chuyển sang ${fallbackModel}:`, error instanceof Error ? error.message : error);
      model = fallbackModel;
      emit({ type: "status", text: "Model chính đang chậm, chuyển sang model dự phòng…" });
      result = await call(model, (text) => emit({ type: "delta", text }));
    }
    const { content, toolCalls } = result;

    if (toolCalls.length === 0) {
      const answer = content.trim() || "AI chưa đưa ra được câu trả lời.";
      await appendThreadMessage(thread, { role: "assistant", content: answer, goal: input.goal, toolsUsed, model });
      if (toolContext.notesChanged) emit({ type: "notes", notes: await listSkuNotes(thread) });
      emit({ type: "answer", text: answer, toolsUsed, model });
      return;
    }

    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      toolsUsed.push(call.function.name);
      emit({ type: "tool", name: call.function.name, label: TOOL_LABELS[call.function.name] || call.function.name });
    }
    const results: string[] = [];
    if (toolCalls.some((call) => call.function.name.endsWith("SkuNote"))) {
      // Tool ghi nhớ chạy tuần tự để giữ đúng thứ tự lưu / xóa.
      for (const call of toolCalls) results.push(await executeTool(toolContext, call.function.name, call.function.arguments));
    } else {
      results.push(...await Promise.all(
        toolCalls.map((call) => executeTool(toolContext, call.function.name, call.function.arguments)),
      ));
    }
    toolCalls.forEach((call, index) => {
      messages.push({ role: "tool", tool_call_id: call.id, content: results[index] });
    });
  }
  throw new Error("AI không hoàn tất được câu trả lời.");
}
