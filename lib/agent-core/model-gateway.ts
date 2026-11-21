// Cổng gọi model dùng chung: mọi agent gọi model qua đây (OpenAI-compatible chat completions + tool calling).
// Cấu hình theo biến môi trường, thứ tự ưu tiên: <PREFIX>_* → AGENT_* → CHEAPKEYAI_* (key sẵn có của hệ thống).
// Đổi nhà cung cấp (API chính hãng, gateway khác) chỉ cần đổi .env, không sửa code agent.

import OpenAI from "openai";

export interface ModelToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ModelRequest {
  messages: ModelMessage[];
  tools?: ModelToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
  /** Nhận từng mảnh chữ khi model đang viết (để giao diện hiện dần). */
  onText?: (text: string) => void;
}

export interface ModelResponse {
  content: string;
  toolCalls: ModelToolCall[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Giao diện tối thiểu runner cần: test truyền model giả, production dùng createModelClient. */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  fallbackModel?: string;
  timeoutMs: number;
}

const DEFAULT_BASE_URL = "https://cheapkeyai.shop/v1";

function env(name: string) {
  return (process.env[name] || "").trim();
}

export function resolveModelConfig(prefix: string, defaults: { model: string; fallbackModel?: string }): ModelConfig {
  const pick = (suffix: string) => env(`${prefix}_${suffix}`) || env(`AGENT_${suffix}`);
  const apiKey = pick("API_KEY") || env("CHEAPKEYAI_TEXT_API_KEY") || env("CHEAPKEYAI_API_KEY");
  if (!apiKey) {
    throw new Error(`Chưa cấu hình API key cho agent (${prefix}_API_KEY, AGENT_API_KEY hoặc CHEAPKEYAI_API_KEY) trong .env`);
  }
  const fallbackModel = pick("FALLBACK_MODEL") || defaults.fallbackModel;
  return {
    apiKey,
    baseURL: (pick("BASE_URL") || env("CHEAPKEYAI_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: pick("MODEL") || defaults.model,
    fallbackModel: fallbackModel || undefined,
    timeoutMs: Number(pick("TIMEOUT_MS")) || 90_000,
  };
}

/**
 * Client OpenAI-compatible có model dự phòng: model chính lỗi / quá thời gian thì thử model dự phòng
 * (không thử lại cùng model để tránh chờ gấp đôi khi nhà cung cấp đang nghẽn).
 */
export function createModelClient(config: ModelConfig): ModelClient {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 1 });

  // Luôn gọi dạng stream rồi ghép lại: (1) chữ hiện dần trên giao diện; (2) một số gateway OpenAI-compatible
  // (đã gặp với cheapkeyai) làm MẤT ký tự xuống dòng ở phản hồi non-stream nhưng stream thì giữ nguyên.
  async function call(model: string, request: ModelRequest): Promise<ModelResponse> {
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);
    const stream = await client.chat.completions.create(
      {
        model,
        messages: request.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        ...(request.tools?.length ? { tools: request.tools, tool_choice: "auto" as const } : {}),
        temperature: request.temperature ?? 0.1,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );
    let content = "";
    let resolvedModel = model;
    let promptTokens = 0;
    let completionTokens = 0;
    const calls: { id: string; name: string; arguments: string }[] = [];
    for await (const chunk of stream) {
      if (chunk.model) resolvedModel = chunk.model;
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        request.onText?.(delta.content);
      }
      for (const part of delta.tool_calls ?? []) {
        const c = (calls[part.index] ||= { id: "", name: "", arguments: "" });
        if (part.id) c.id = part.id;
        if (part.function?.name) c.name += part.function.name;
        if (part.function?.arguments) c.arguments += part.function.arguments;
      }
    }
    const toolCalls = calls
      .filter((c) => c && c.name)
      .map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.arguments } }));
    if (!content && !toolCalls.length) throw new Error("Model không trả về kết quả.");
    return { content, toolCalls, model: resolvedModel, promptTokens, completionTokens };
  }

  return {
    async complete(request) {
      try {
        return await call(config.model, request);
      } catch (error) {
        if (request.signal?.aborted || !config.fallbackModel || config.fallbackModel === config.model) throw error;
        console.warn(`[agent] Model ${config.model} lỗi, chuyển sang ${config.fallbackModel}:`, error instanceof Error ? error.message : error);
        return call(config.fallbackModel, request);
      }
    },
  };
}
