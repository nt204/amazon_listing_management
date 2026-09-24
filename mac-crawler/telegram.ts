/**
 * Module thông báo Telegram an toàn cho Mac mini PPC Crawler.
 * - Tự động nhận diện config từ config.env (hoặc biến môi trường hệ thống).
 * - Sử dụng HTML parse mode để không bao giờ bị lỗi escape ký tự như Markdown.
 * - Hỗ trợ cả Proxy Cloudflare Worker lẫn direct Telegram API.
 * - Hỗ trợ Topic ID (Forum thread).
 * - Tự động bắt lỗi (try/catch + timeout 8s), tuyệt đối không bao giờ làm gián đoạn hay crash tiến trình crawl chính.
 */

function getEnv(name: string, fallbackName?: string): string {
  const val = process.env[name] || (fallbackName ? process.env[fallbackName] : "") || "";
  return val.trim();
}

export function isTelegramConfigured(): boolean {
  const token = getEnv("TELEGRAM_BOT_TOKEN", "PPC_TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("TELEGRAM_CHAT_ID", "PPC_TELEGRAM_CHAT_ID");
  return Boolean(token && chatId);
}

export function getTelegramConfig() {
  const token = getEnv("TELEGRAM_BOT_TOKEN", "PPC_TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("TELEGRAM_CHAT_ID", "PPC_TELEGRAM_CHAT_ID");
  const topicId = getEnv("TELEGRAM_TOPIC_ID", "PPC_TELEGRAM_TOPIC_ID");
  const proxyUrl = getEnv("TELEGRAM_PROXY_URL", "PPC_TELEGRAM_PROXY_URL");
  const baseUrl = proxyUrl ? proxyUrl.replace(/\/+$/, "") : "https://api.telegram.org";
  return { token, chatId, topicId, proxyUrl, baseUrl };
}

export async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
  const { token, baseUrl } = getTelegramConfig();
  if (!token || !callbackQueryId) return false;
  const url = `${baseUrl}/bot${token}/answerCallbackQuery`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || "" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessage(
  text: string,
  topicIdOverride?: string | number,
  replyMarkup?: any,
): Promise<boolean> {
  const { token, chatId, baseUrl } = getTelegramConfig();
  const topicId = topicIdOverride ?? getEnv("TELEGRAM_TOPIC_ID", "PPC_TELEGRAM_TOPIC_ID");

  if (!token || !chatId) {
    return false;
  }

  const url = `${baseUrl}/bot${token}/sendMessage`;

  const payload: Record<string, any> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  if (topicId && String(topicId).trim()) {
    payload.message_thread_id = Number(topicId);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("Telegram request timeout"), 8000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        return true;
      }

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retryAfter = Number(data?.parameters?.retry_after || 5);
        if (attempt < 3) {
          console.warn(`[Telegram] Bị rate limit 429, chờ ${retryAfter}s trước khi thử lại...`);
          await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
          continue;
        }
      }

      const errorText = await response.text().catch(() => "");
      console.warn(`[Telegram] Gửi tin thất bại (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
      return false;
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.warn(`[Telegram] Gửi tin nhắn timeout sau 8s, bỏ qua.`);
        return false;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.warn(`[Telegram] Lỗi kết nối Telegram: ${err.message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  return false;
}

function escapeHtml(unsafe: string): string {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * 1. Báo bắt đầu ca chạy
 */
export async function notifyCrawlerStart(params: {
  batchDate: string;
  storeNames: string[];
  workerId?: string;
}): Promise<void> {
  if (!isTelegramConfigured()) return;
  const storeListStr = params.storeNames.map((s) => `<code>${escapeHtml(s)}</code>`).join(", ");
  const text = [
    `🚀 <b>[PPC CRAWLER] BẮT ĐẦU CA CHẠY MỚI</b>`,
    `📅 <b>Ngày:</b> <code>${escapeHtml(params.batchDate)}</code>`,
    `🏪 <b>Số store:</b> ${params.storeNames.length} (${storeListStr})`,
    params.workerId ? `💻 <b>Máy Mac:</b> <code>${escapeHtml(params.workerId)}</code>` : "",
    `⏱️ <b>Khởi động lúc:</b> ${new Date().toLocaleTimeString("vi-VN")}`,
  ].filter(Boolean).join("\n");

  await sendTelegramMessage(text);
}

/**
 * 2. Báo lỗi nghiêm trọng khi một store thất bại
 */
export async function notifyStoreFailure(params: {
  storeName: string;
  error: string;
  attempt?: number;
  maxAttempts?: number;
}): Promise<void> {
  if (!isTelegramConfigured()) return;
  const attemptStr = params.attempt && params.maxAttempts ? ` (Lần ${params.attempt}/${params.maxAttempts})` : "";
  const text = [
    `⚠️ <b>[PPC CRAWLER] CẢNH BÁO SỰ CỐ STORE</b>`,
    `🏪 <b>Store:</b> <code>${escapeHtml(params.storeName)}</code>${attemptStr}`,
    `❌ <b>Chi tiết lỗi:</b>`,
    `<pre>${escapeHtml(params.error.slice(0, 500))}</pre>`,
    `🛠️ <i>Hệ thống sẽ thử lại hoặc bỏ qua sang store kế tiếp theo cấu hình.</i>`,
  ].join("\n");

  await sendTelegramMessage(text);
}

/**
 * 3. Báo tổng kết hoàn tất toàn bộ ca chạy
 */
export async function notifyCrawlerSummary(params: {
  batchDate: string;
  successStores: string[];
  failedStores: string[];
  totalFiles: number;
  elapsedMs: number;
  workerId?: string;
  ingestionPending?: boolean;
}): Promise<void> {
  if (!isTelegramConfigured()) return;
  const isAllSuccess = params.failedStores.length === 0;
  const icon = isAllSuccess ? "✅" : "⚠️";
  const header = isAllSuccess
    ? (params.ingestionPending
      ? `<b>[PPC CRAWLER] ĐÃ BÀN GIAO SERVER INGEST!</b>`
      : `<b>[PPC CRAWLER] HOÀN TẤT XUẤT SẮC CA CHẠY!</b>`)
    : `<b>[PPC CRAWLER] KẾT THÚC CA CHẠY (CÓ STORE CẦN CHÚ Ý)</b>`;

  const successList = params.successStores.length > 0
    ? params.successStores.map((s) => `<code>${escapeHtml(s)}</code>`).join(", ")
    : "Không có";

  const lines = [
    `${icon} ${header}`,
    `📅 <b>Ngày:</b> <code>${escapeHtml(params.batchDate)}</code>`,
    `⏱️ <b>Thời gian xử lý:</b> <b>${formatElapsed(params.elapsedMs)}</b>`,
    `📊 <b>Kết quả store:</b> ${params.successStores.length}/${params.successStores.length + params.failedStores.length} store thành công`,
    `🟢 <b>Thành công:</b> ${successList}`,
  ];

  if (params.failedStores.length > 0) {
    const failedList = params.failedStores.map((s) => `<code>${escapeHtml(s)}</code>`).join(", ");
    lines.push(`🔴 <b>Thất bại:</b> ${failedList}`);
  }

  lines.push(params.ingestionPending
    ? `📁 <b>Tổng số file:</b> <b>${params.totalFiles}</b> file đã đẩy R2; server đang nạp nền.`
    : `📁 <b>Tổng số file:</b> <b>${params.totalFiles}</b> file đã đẩy R2 & nạp Server.`);
  if (params.workerId) {
    lines.push(`💻 <b>Máy Mac:</b> <code>${escapeHtml(params.workerId)}</code>`);
  }

  await sendTelegramMessage(lines.join("\n"));
}

/**
 * 4. Báo kết quả Auto Upload Bulksheet (nếu có sử dụng tính năng nạp ngược)
 */
export async function notifyBulkUploadResult(params: {
  storeName: string;
  fileName: string;
  status: "SUCCESS" | "FAILED";
  error?: string;
  jobId?: string;
}): Promise<void> {
  if (!isTelegramConfigured()) return;
  const isOk = params.status === "SUCCESS";
  const icon = isOk ? "📤 ✅" : "📤 ❌";
  const title = isOk ? "TẢI LÊN AMAZON BULKSHEET THÀNH CÔNG" : "TẢI LÊN AMAZON BULKSHEET THẤT BẠI";

  const lines = [
    `${icon} <b>[PPC AUTO UPLOAD] ${title}</b>`,
    `🏪 <b>Store:</b> <code>${escapeHtml(params.storeName)}</code>`,
    `📄 <b>File:</b> <code>${escapeHtml(params.fileName)}</code>`,
  ];

  if (!isOk && params.error) {
    lines.push(`❌ <b>Lỗi:</b> <pre>${escapeHtml(params.error.slice(0, 400))}</pre>`);
  }

  await sendTelegramMessage(lines.join("\n"));
}
