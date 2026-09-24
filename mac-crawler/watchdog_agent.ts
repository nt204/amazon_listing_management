/**
 * Watchdog Agent - Giám sát thông minh & Tự phục hồi lỗi cho Mac Crawler
 *
 * Tính năng chính:
 * 1. Phân loại lỗi theo Rule cứng (Deterministic):
 *    - AdsPower API sập -> Báo Telegram, KHÔNG gọi AI (0 token).
 *    - Amazon OTP / Captcha -> Báo Telegram gọi người, KHÔNG gọi AI (0 token).
 *    - Lỗi mạng tạm thời / File đang tải -> Tự gia hạn/retry, KHÔNG gọi AI (0 token).
 * 2. Hai tầng AI tiết kiệm chi phí tối đa:
 *    - Chỉ gọi AI khi phát hiện lỗi DOM / Selector Amazon thay đổi hoặc Crash lặp lại.
 *    - Tầng 1: Chẩn đoán nhanh (~200 tokens = 10đ) bằng CheapKeyAI (gpt-6-sol / gpt-5.6-sol).
 *    - Tầng 2: GỬI DUYỆT TELEGRAM TRƯỚC! Chỉ khi người dùng bấm [✅ Cho phép AI vá], AI mới sinh code patch.
 * 3. Chốt chặn an toàn (Safety Guardrails):
 *    - Luôn backup file crawler.ts trước khi sửa.
 *    - Kiểm tra biên dịch bắt buộc bằng `npx tsc --noEmit`. Nếu lỗi, hoàn tác code gốc 100%.
 *    - Sau khi vá thành công, tự động kickstart lại worker qua launchd.
 * 4. Điều khiển Bật/Tắt Agent bằng Telegram:
 *    - Lệnh chat: `/agent on`, `/agent off`, `/agent status`.
 *    - Nút bấm trực tiếp trên tin nhắn sự cố: [🛑 Tắt Agent], [▶️ Bật Agent].
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  sendTelegramMessage,
  answerTelegramCallbackQuery,
  getTelegramConfig,
  isTelegramConfigured,
} from "./telegram";

// ============================================================================
// CẤU HÌNH & KHỞI TẠO
// ============================================================================

const CHEAPKEYAI_KEY = (
  process.env.WATCHDOG_AI_KEY ||
  process.env.CHEAPKEYAI_API_KEY ||
  "sk-x36p7SPjY3K9q4cqaARJR0TT8LpsHH1wL5AmFaEdfhZbVmAa"
).trim();

const CHEAPKEYAI_BASE_URL = (
  process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1"
).replace(/\/+$/, "");

const PRIMARY_MODEL = process.env.WATCHDOG_AI_MODEL || "gpt-6-sol";
const FALLBACK_MODEL = "gpt-5.6-sol";

const STATE_FILE_PATH = path.join(__dirname, "scratch", "watchdog_state.json");
const CRAWLER_FILE_PATH = path.join(__dirname, "crawler.ts");

interface WatchdogState {
  enabled: boolean;
  model: string;
  totalIncidents: number;
  totalPatchesApplied: number;
  lastIncidentAt?: string;
}

interface PendingIncident {
  id: string;
  storeName: string;
  taskName: string;
  errorMessage: string;
  logSnippet: string;
  diagnosis: AiDiagnosisResult;
  createdAt: number;
}

interface AiDiagnosisResult {
  rootCause: string;
  affectedFunction: string;
  canAutoPatch: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH";
  suggestedFix: string;
}

const pendingIncidents = new Map<string, PendingIncident>();

// ============================================================================
// QUẢN LÝ TRẠNG THÁI ON/OFF
// ============================================================================

function ensureScratchDir(): void {
  const dir = path.join(__dirname, "scratch");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

export function loadWatchdogState(): WatchdogState {
  ensureScratchDir();
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE_PATH, "utf8"));
      return {
        enabled: data.enabled !== false,
        model: data.model || PRIMARY_MODEL,
        totalIncidents: Number(data.totalIncidents || 0),
        totalPatchesApplied: Number(data.totalPatchesApplied || 0),
        lastIncidentAt: data.lastIncidentAt,
      };
    }
  } catch {}
  return {
    enabled: process.env.WATCHDOG_ENABLED !== "false",
    model: PRIMARY_MODEL,
    totalIncidents: 0,
    totalPatchesApplied: 0,
  };
}

export function saveWatchdogState(state: WatchdogState): void {
  ensureScratchDir();
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.warn(`[Watchdog] Không thể lưu state file: ${(err as Error).message}`);
  }
}

export function isWatchdogEnabled(): boolean {
  return loadWatchdogState().enabled;
}

export function setWatchdogEnabled(enabled: boolean): WatchdogState {
  const state = loadWatchdogState();
  state.enabled = enabled;
  saveWatchdogState(state);
  return state;
}

// ============================================================================
// BỘ PHÂN LOẠI LỖI (DETERMINISTIC RULES - 0 TOKEN)
// ============================================================================

export interface ClassifiedIncident {
  category: "NO_AI_RULE" | "AI_ELIGIBLE" | "IGNORE";
  signature: string;
  reason: string;
  alertTitle: string;
  alertBody: string;
}

export function classifyError(error: unknown, context: { storeName?: string; taskName?: string }): ClassifiedIncident {
  const message = (typeof error === "string" ? error : (error as Error)?.message || String(error || "")).toLowerCase();
  const store = context.storeName || "Store";
  const task = context.taskName || "Crawl";

  // 1. AdsPower Local API không phản hồi
  if (
    message.includes("50325") ||
    message.includes("local.adspower.net") ||
    message.includes("econnrefused") ||
    message.includes("failed to connect to adspower")
  ) {
    return {
      category: "NO_AI_RULE",
      signature: "ADSPOWER_API_DOWN",
      reason: "AdsPower Local API (cổng 50325) không phản hồi hoặc ứng dụng chưa mở.",
      alertTitle: "⚠️ <b>[WATCHDOG] LỖI KẾT NỐI ADSPOWER</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> Không thể kết nối cổng 50325.\n👉 <i>Vui lòng mở hoặc kiểm tra ứng dụng AdsPower trên Mac mini.</i>`,
    };
  }

  // 2. Amazon yêu cầu OTP / Captcha / Re-login
  if (
    message.includes("auth-challenge") ||
    message.includes("otp") ||
    message.includes("captcha") ||
    message.includes("two-factor") ||
    message.includes("verification") ||
    message.includes("signin") ||
    message.includes("đăng nhập lại")
  ) {
    return {
      category: "NO_AI_RULE",
      signature: "AMAZON_AUTH_CHALLENGE",
      reason: "Amazon yêu cầu xác minh bảo mật hoặc phiên đăng nhập hết hạn.",
      alertTitle: "🔐 <b>[WATCHDOG] AMAZON YÊU CẦU ĐĂNG NHẬP / OTP</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> Amazon bắt xác minh OTP hoặc hết phiên.\n👉 <i>Vui lòng mở profile AdsPower của store này để đăng nhập lại.</i>`,
    };
  }

  // 3. File đang tải dở hoặc lỗi mạng thoáng qua
  if (message.includes(".crdownload") || message.includes("econnreset") || message.includes("socket hang up")) {
    return {
      category: "IGNORE",
      signature: "TRANSIENT_NETWORK",
      reason: "Mạng bị ngắt thoáng qua hoặc file đang ghi, crawler tự động retry.",
      alertTitle: "",
      alertBody: "",
    };
  }

  // 4. Lỗi cấu hình R2 / S3
  if (message.includes("r2") && (message.includes("nosuchbucket") || message.includes("invalidaccesskeyid"))) {
    return {
      category: "NO_AI_RULE",
      signature: "R2_CONFIG_ERROR",
      reason: "Sai cấu hình Cloudflare R2 Credentials.",
      alertTitle: "☁️ <b>[WATCHDOG] LỖI CẤU HÌNH R2</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Chi tiết:</b> ${message}\n👉 <i>Kiểm tra lại R2_ACCESS_KEY_ID hoặc R2_SECRET_ACCESS_KEY trong config.env.</i>`,
    };
  }

  // 4.1. Tràn RAM (OOM - Out Of Memory / Heap Limit)
  if (
    message.includes("heap out of memory") ||
    message.includes("enomem") ||
    message.includes("out of memory") ||
    message.includes("allocation failed")
  ) {
    return {
      category: "NO_AI_RULE",
      signature: "SYSTEM_OOM",
      reason: "Tiến trình bị tràn RAM do dữ liệu lớn hoặc thiếu bộ nhớ trên Mac mini.",
      alertTitle: "💥 <b>[WATCHDOG] CẢNH BÁO TRÀN BỘ NHỚ RAM (OOM)</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> Node.js hết bộ nhớ RAM (Heap Out of Memory).\n👉 <i>Tiến trình sẽ tự dọn dẹp và khởi động lại.</i>`,
    };
  }

  // 4.2. Trình duyệt sập / Chrome crash / Target crashed
  if (
    message.includes("target closed") ||
    message.includes("target crashed") ||
    message.includes("page crashed") ||
    message.includes("browser has been closed") ||
    message.includes("browser disconnected")
  ) {
    return {
      category: "NO_AI_RULE",
      signature: "BROWSER_CRASH",
      reason: "Trình duyệt Chromium của AdsPower bị đóng hoặc crash bất ngờ.",
      alertTitle: "💥 <b>[WATCHDOG] TRÌNH DUYỆT BỊ SẬP (BROWSER CRASH)</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> Profile Chromium bị đóng bất ngờ.\n👉 <i>Crawler sẽ tự đóng profile cũ và mở lại để chạy tiếp.</i>`,
    };
  }

  // 5. Amazon thay đổi DOM / Selector không tìm thấy -> ĐỦ ĐIỀU KIỆN GỌI AI
  if (
    message.includes("waiting for selector") ||
    message.includes("waiting for locator") ||
    message.includes("element not found") ||
    message.includes("could not find download button") ||
    message.includes("không tìm thấy selector") ||
    message.includes("timeout") && (message.includes("button") || message.includes("select") || message.includes("click"))
  ) {
    return {
      category: "AI_ELIGIBLE",
      signature: "SELECTOR_NOT_FOUND",
      reason: "Không tìm thấy nút hoặc thành phần giao diện Amazon; nghi vấn Amazon đổi giao diện.",
      alertTitle: "🚨 <b>[WATCHDOG AI] PHÁT HIỆN LỖI GIAO DIỆN AMAZON</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> ${message}`,
    };
  }

  // 6. Tương tác DOM bị chặn (Click intercepted, element detached)
  if (message.includes("click intercepted") || message.includes("is not visible") || message.includes("detached from the dom")) {
    return {
      category: "AI_ELIGIBLE",
      signature: "DOM_INTERACTION_FAILED",
      reason: "Thành phần DOM bị che khuất hoặc bị tháo gỡ trong quá trình click.",
      alertTitle: "🚨 <b>[WATCHDOG AI] LỖI TƯƠNG TÁC GIAO DIỆN AMAZON</b>",
      alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> ${message}`,
    };
  }

  // 7. Ngoại lệ runtime khác
  return {
    category: "AI_ELIGIBLE",
    signature: "FATAL_EXCEPTION",
    reason: "Lỗi runtime bất thường xảy ra trong quá trình crawl.",
    alertTitle: "🚨 <b>[WATCHDOG AI] PHÁT HIỆN SỰ CỐ BẤT THƯỜNG</b>",
    alertBody: `• <b>Store:</b> ${store}\n• <b>Tác vụ:</b> ${task}\n• <b>Chi tiết:</b> ${message}`,
  };
}

// ============================================================================
// TẦNG 1: GỌI CHEAPKEYAI ĐỂ CHẨN ĐOÁN (SIÊU NHẸ ~200-300 TOKENS)
// ============================================================================

async function callCheapKeyAI(messages: any[], maxTokens = 500): Promise<string> {
  const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL, "cheap-5.6-sol"];
  let lastError: unknown;

  for (const model of modelsToTry) {
    try {
      const response = await fetch(`${CHEAPKEYAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CHEAPKEYAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 404 || body.includes("model_not_found") || body.includes("No available channel")) {
          console.warn(`[Watchdog AI] Model ${model} không khả dụng, thử fallback...`);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "";
      if (content) return content;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function diagnoseIncident(params: {
  storeName: string;
  taskName: string;
  errorMessage: string;
  logSnippet: string;
}): Promise<AiDiagnosisResult> {
  const systemPrompt = `Bạn là kỹ sư chẩn đoán lỗi crawler Amazon PPC viết bằng Playwright/TypeScript.
Nhiệm vụ: Phân tích log lỗi ngắn gọn và trả về DUY NHẤT một chuỗi JSON hợp lệ với cấu trúc sau:
{
  "rootCause": "Mô tả nguyên nhân lỗi ngắn gọn 1 câu",
  "affectedFunction": "Tên hàm trong crawler.ts (ví dụ downloadSearchTermReport, waitForBulkFileDownload, navigateToBulkPage)",
  "canAutoPatch": true,
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "suggestedFix": "Cách khắc phục ngắn gọn 1 câu"
}
Lưu ý: Chỉ trả về JSON, không giải thích ngoài JSON.`;

  const userPrompt = `Store: ${params.storeName}
Tác vụ: ${params.taskName}
Lỗi bắt được: ${params.errorMessage}
Log gần nhất:
${params.logSnippet}`;

  try {
    const raw = await callCheapKeyAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 300);

    const cleanJson = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    return {
      rootCause: parsed.rootCause || "Nghi vấn selector hoặc giao diện thay đổi",
      affectedFunction: parsed.affectedFunction || "crawler.ts",
      canAutoPatch: parsed.canAutoPatch !== false,
      risk: (parsed.risk || "LOW").toUpperCase() as any,
      suggestedFix: parsed.suggestedFix || "Cập nhật selector mới",
    };
  } catch (err) {
    return {
      rootCause: `Không thể parse chẩn đoán AI: ${(err as Error).message}`,
      affectedFunction: "crawler.ts",
      canAutoPatch: false,
      risk: "MEDIUM",
      suggestedFix: "Kiểm tra log chi tiết thủ công",
    };
  }
}

// ============================================================================
// TẦNG 2: DUYỆT TELEGRAM TRƯỚC KHI SINH CODE (TIẾT KIỆM TOKEN TUYỆT ĐỐI)
// ============================================================================

export async function requestTelegramApprovalForPatch(incident: PendingIncident): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const text = `${incident.diagnosis.risk === "HIGH" ? "⚠️" : "🤖"} <b>[WATCHDOG AI DIAGNOSIS]</b>
• <b>Store:</b> ${incident.storeName}
• <b>Tác vụ:</b> ${incident.taskName}
• <b>Nguyên nhân:</b> ${incident.diagnosis.rootCause}
• <b>Hàm liên quan:</b> <code>${incident.diagnosis.affectedFunction}</code>
• <b>Mức độ rủi ro:</b> <b>${incident.diagnosis.risk}</b>
• <b>Gợi ý sửa:</b> ${incident.diagnosis.suggestedFix}

<i>Chi phí dự kiến sinh code vá: ~500đ (${PRIMARY_MODEL}).</i>
👉 <b>Bạn có đồng ý cho AI sinh mã vá và kiểm tra không?</b>`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✅ Cho phép AI vá code", callback_data: `APPR:${incident.id}` },
        { text: "❌ Bỏ qua", callback_data: `DISMISS:${incident.id}` },
      ],
      [
        { text: "🛑 Tắt Watchdog Agent", callback_data: `AGENT_OFF` },
      ],
    ],
  };

  return await sendTelegramMessage(text, undefined, replyMarkup);
}

// ============================================================================
// TẦNG 3: SINH PATCH & VALIDATE TYPESCRIPT TRƯỚC KHI RESTART
// ============================================================================

export async function generateAndApplyPatch(incidentId: string): Promise<{ success: boolean; message: string }> {
  const incident = pendingIncidents.get(incidentId);
  if (!incident) {
    return { success: false, message: "Sự cố không tồn tại hoặc đã hết hạn (30 phút)." };
  }

  if (!fs.existsSync(CRAWLER_FILE_PATH)) {
    return { success: false, message: "Không tìm thấy file crawler.ts." };
  }

  await sendTelegramMessage(
    `⏳ <b>[WATCHDOG AI]</b> Đang đọc mã nguồn và dùng <b>${PRIMARY_MODEL}</b> sinh bản vá cho hàm <code>${incident.diagnosis.affectedFunction}</code>...`
  );

  const fullCode = fs.readFileSync(CRAWLER_FILE_PATH, "utf8");

  // Trích xuất đoạn code chứa hàm bị ảnh hưởng để tiết kiệm token
  let contextCode = fullCode;
  const fnName = incident.diagnosis.affectedFunction.trim();
  const fnIndex = fullCode.indexOf(fnName);
  if (fnIndex !== -1) {
    const start = Math.max(0, fnIndex - 500);
    const end = Math.min(fullCode.length, fnIndex + 2500);
    contextCode = fullCode.slice(start, end);
  } else {
    // Nếu không tìm thấy chính xác, lấy 3000 ký tự đầu của file
    contextCode = fullCode.slice(0, 3000);
  }

  const systemPrompt = `Bạn là lập trình viên TypeScript cao cấp sửa lỗi Playwright cho Amazon PPC crawler.
Dưới đây là một đoạn code từ crawler.ts và lỗi đã xảy ra.
Nhiệm vụ: Cung cấp đoạn code thay thế chính xác để khắc phục lỗi.
YÊU CẦU BẮT BUỘC:
1. Trả về DUY NHẤT một đối tượng JSON:
{
  "targetSnippet": "chuỗi ký tự code gốc CHÍNH XÁC trong file cần bị thay thế",
  "replacementSnippet": "chuỗi ký tự code mới thay thế cho targetSnippet",
  "explanation": "giải thích ngắn gọn thay đổi (1-2 câu)"
}
2. "targetSnippet" phải khớp 100% từng dấu cách/ký tự trong code gốc.
3. Không sửa logic ngoài phạm vi lỗi. Chỉ trả về JSON hợp lệ.`;

  const userPrompt = `Hàm bị lỗi: ${incident.diagnosis.affectedFunction}
Lỗi: ${incident.errorMessage}
Gợi ý sửa: ${incident.diagnosis.suggestedFix}

Đoạn mã nguồn ngữ cảnh:
\`\`\`typescript
${contextCode}
\`\`\``;

  let patchResult: { targetSnippet: string; replacementSnippet: string; explanation: string };
  try {
    const aiOutput = await callCheapKeyAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 1200);

    const clean = aiOutput.replace(/```json/g, "").replace(/```/g, "").trim();
    patchResult = JSON.parse(clean);
    if (!patchResult.targetSnippet || !patchResult.replacementSnippet) {
      throw new Error("AI không trả về đủ targetSnippet hoặc replacementSnippet.");
    }
  } catch (err) {
    const msg = `Lỗi sinh bản vá từ AI: ${(err as Error).message}`;
    await sendTelegramMessage(`❌ <b>[WATCHDOG AI] VÁ THẤT BẠI:</b> ${msg}`);
    return { success: false, message: msg };
  }

  // Kiểm tra targetSnippet có tồn tại trong file gốc không
  if (!fullCode.includes(patchResult.targetSnippet)) {
    const msg = "Đoạn code targetSnippet do AI cung cấp không khớp với crawler.ts hiện tại.";
    await sendTelegramMessage(`❌ <b>[WATCHDOG AI] VÁ THẤT BẠI:</b> ${msg}`);
    return { success: false, message: msg };
  }

  // 1. Tạo file backup
  const backupPath = `${CRAWLER_FILE_PATH}.watchdog.bak`;
  fs.writeFileSync(backupPath, fullCode, "utf8");

  try {
    // 2. Áp dụng thay thế
    const patchedCode = fullCode.replace(patchResult.targetSnippet, patchResult.replacementSnippet);
    fs.writeFileSync(CRAWLER_FILE_PATH, patchedCode, "utf8");

    // 3. Static check: Chạy tsc --noEmit
    try {
      const localTsc = path.join(path.dirname(CRAWLER_FILE_PATH), "node_modules", ".bin", "tsc");
      const tscCmd = fs.existsSync(localTsc) ? `"${localTsc}" --noEmit` : "npx tsc --noEmit";
      execSync(tscCmd, {
        cwd: path.dirname(CRAWLER_FILE_PATH),
        env: {
          ...process.env,
          PATH: `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${process.env.PATH || ""}`,
        },
        timeout: 45000,
        stdio: "pipe",
      });
    } catch (tscErr: any) {
      // Biên dịch thất bại -> Khôi phục code gốc ngay lập tức!
      fs.writeFileSync(CRAWLER_FILE_PATH, fullCode, "utf8");
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);

      const stderr = tscErr?.stderr?.toString() || tscErr?.stdout?.toString() || tscErr.message;
      const cleanErr = stderr.slice(0, 300);
      await sendTelegramMessage(
        `❌ <b>[WATCHDOG AI] BẢN VÁ BỊ TỪ CHỐI BỞI TYPESCRIPT COMPILER</b>\n<code>${cleanErr}</code>\n\n🛡️ <i>Đã khôi phục lại 100% mã nguồn gốc an toàn.</i>`
      );
      return { success: false, message: `TypeScript check failed: ${cleanErr}` };
    }

    // 4. Biên dịch thành công -> Xóa backup & cập nhật thống kê
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);

    const state = loadWatchdogState();
    state.totalPatchesApplied += 1;
    saveWatchdogState(state);
    pendingIncidents.delete(incidentId);

    // 5. Khởi động lại Worker qua LaunchAgent nếu trên macOS
    let restartNotice = "Tiến trình worker sẽ tải mã mới ở lần chạy tiếp theo.";
    try {
      if (process.platform === "darwin") {
        const uid = os.userInfo().uid;
        execSync(`launchctl kickstart -k gui/${uid}/com.amazon.ppc.worker`, { stdio: "ignore" });
        restartNotice = "Worker (com.amazon.ppc.worker) đã được restart thành công!";
      }
    } catch (restartErr) {
      restartNotice = `Không thể kickstart: ${(restartErr as Error).message}`;
    }

    await sendTelegramMessage(
      `✅ <b>[WATCHDOG AI] ĐÃ VÁ LỖI THÀNH CÔNG!</b>
• <b>Hàm sửa:</b> <code>${incident.diagnosis.affectedFunction}</code>
• <b>Thay đổi:</b> ${patchResult.explanation}
• <b>Kiểm tra:</b> ✅ TypeScript pass (0 lỗi biên dịch)
• <b>Tiến trình:</b> ${restartNotice}`
    );

    return { success: true, message: "Patch applied successfully." };
  } catch (applyErr) {
    // Trường hợp ngoại lệ khẩn cấp: Khôi phục từ backup
    if (fs.existsSync(backupPath)) {
      fs.writeFileSync(CRAWLER_FILE_PATH, fs.readFileSync(backupPath, "utf8"), "utf8");
      fs.unlinkSync(backupPath);
    }
    const msg = `Lỗi áp dụng patch: ${(applyErr as Error).message}`;
    await sendTelegramMessage(`❌ <b>[WATCHDOG AI] LỖI KHÔNG MONG MUỐN:</b> ${msg}`);
    return { success: false, message: msg };
  }
}

// ============================================================================
// HÀM ENTRYPOINT XỬ LÝ LỖI TỪ CRAWLER / WORKER
// ============================================================================

export async function handleWatchdogError(params: {
  storeName: string;
  taskName: string;
  error: unknown;
  logSnippet?: string;
}): Promise<void> {
  const classification = classifyError(params.error, {
    storeName: params.storeName,
    taskName: params.taskName,
  });

  // Cập nhật thống kê
  const state = loadWatchdogState();
  state.totalIncidents += 1;
  state.lastIncidentAt = new Date().toISOString();
  saveWatchdogState(state);

  // Nếu lỗi bị bỏ qua (mạng lag tạm thời / file đang ghi)
  if (classification.category === "IGNORE") {
    console.log(`[Watchdog] Bỏ qua lỗi tạm thời: ${classification.signature}`);
    return;
  }

  // Nếu lỗi thuộc Rule cứng (AdsPower tắt, Amazon OTP) -> Không gọi AI, báo Telegram ngay!
  if (classification.category === "NO_AI_RULE") {
    console.warn(`[Watchdog Rule] ${classification.signature}: ${classification.reason}`);
    await sendTelegramMessage(`${classification.alertTitle}\n${classification.alertBody}`);
    return;
  }

  // Nếu Watchdog Agent đang bị TẮT bởi người dùng
  if (!state.enabled) {
    console.log(`[Watchdog] Agent đang TẮT. Bỏ qua phân tích AI cho lỗi: ${classification.signature}`);
    return;
  }

  // Sự cố thuộc nhóm AI_ELIGIBLE -> Tiến hành Tầng 1: Chẩn đoán nhanh
  console.log(`[Watchdog] Kích hoạt AI Chẩn đoán cho lỗi: ${classification.signature}...`);
  const errorMsg =
    typeof params.error === "string"
      ? params.error
      : (params.error as Error)?.message || String(params.error || "");
  const diagnosis = await diagnoseIncident({
    storeName: params.storeName,
    taskName: params.taskName,
    errorMessage: errorMsg,
    logSnippet: params.logSnippet || errorMsg,
  });

  const incidentId = `inc_${Date.now().toString(36)}`;
  const incident: PendingIncident = {
    id: incidentId,
    storeName: params.storeName,
    taskName: params.taskName,
    errorMessage: errorMsg,
    logSnippet: params.logSnippet || errorMsg,
    diagnosis,
    createdAt: Date.now(),
  };

  pendingIncidents.set(incidentId, incident);

  // Tự động hết hạn sau 30 phút để dọn RAM
  setTimeout(() => {
    pendingIncidents.delete(incidentId);
  }, 30 * 60 * 1000);

  // Gửi Telegram để xin duyệt (Duyệt rồi mới sinh code để tiết kiệm tiền!)
  await requestTelegramApprovalForPatch(incident);
}

// ============================================================================
// TELEGRAM LISTENER: NHẬN LỆNH BẬT/TẮT & CALLBACK DUYỆT VÁ
// ============================================================================

let isListenerRunning = false;
let lastUpdateId = 0;

export function startTelegramListener(): void {
  if (isListenerRunning || !isTelegramConfigured()) return;
  isListenerRunning = true;

  console.log("[Watchdog Telegram] Khởi động trình lắng nghe lệnh & callback Telegram...");

  const { token, baseUrl, chatId } = getTelegramConfig();

  const pollUpdates = async () => {
    try {
      const url = `${baseUrl}/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        setTimeout(pollUpdates, 5000);
        return;
      }

      const data = await response.json();
      if (Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          // 1. Xử lý Callback Queries từ nút bấm Inline
          if (update.callback_query) {
            const cb = update.callback_query;
            const cbData = String(cb.data || "");
            const fromChatId = String(cb.message?.chat?.id || "");

            // Xác thực bảo mật: Chỉ cho phép chat_id đã cấu hình
            if (chatId && fromChatId && String(chatId) !== fromChatId) {
              await answerTelegramCallbackQuery(cb.id, "Không có quyền.");
              continue;
            }

            if (cbData.startsWith("APPR:")) {
              const incId = cbData.replace("APPR:", "");
              await answerTelegramCallbackQuery(cb.id, "Đang bắt đầu sinh code vá...");
              void generateAndApplyPatch(incId);
            } else if (cbData.startsWith("DISMISS:")) {
              const incId = cbData.replace("DISMISS:", "");
              pendingIncidents.delete(incId);
              await answerTelegramCallbackQuery(cb.id, "Đã bỏ qua sự cố.");
              await sendTelegramMessage("👌 <i>Đã bỏ qua sự cố theo yêu cầu.</i>");
            } else if (cbData === "AGENT_OFF") {
              setWatchdogEnabled(false);
              await answerTelegramCallbackQuery(cb.id, "Đã tắt Watchdog Agent.");
              await sendTelegramMessage(
                "🛑 <b>Watchdog Agent ĐÃ TẮT</b>.\nCrawler sẽ chỉ chạy logic gốc, AI sẽ không can thiệp."
              );
            } else if (cbData === "AGENT_ON") {
              setWatchdogEnabled(true);
              await answerTelegramCallbackQuery(cb.id, "Đã bật Watchdog Agent.");
              await sendTelegramMessage(
                "🟢 <b>Watchdog Agent ĐÃ BẬT</b>.\nHệ thống sẽ tự động theo dõi lỗi & xin duyệt khi cần vá."
              );
            }
          }

          // 2. Xử lý Tin nhắn văn bản (/agent on, /agent off, /agent status)
          if (update.message?.text) {
            const text = update.message.text.trim().toLowerCase();
            const fromChatId = String(update.message.chat?.id || "");

            if (chatId && fromChatId && String(chatId) !== fromChatId) {
              continue;
            }

            if (text === "/agent on" || text === "bật agent" || text === "/start") {
              const state = setWatchdogEnabled(true);
              await sendTelegramMessage(
                `🟢 <b>WATCHDOG AGENT ĐÃ BẬT</b>\n• <b>Model:</b> ${state.model}\n• <b>Cơ chế:</b> Duyệt trước khi sinh code (Siêu tiết kiệm token)\n• <b>Trạng thái:</b> Sẵn sàng bảo vệ crawler.`
              );
            } else if (text === "/agent off" || text === "tắt agent") {
              setWatchdogEnabled(false);
              await sendTelegramMessage(
                `🛑 <b>WATCHDOG AGENT ĐÃ TẮT</b>\nCrawler sẽ tiếp tục hoạt động theo logic mặc định mà không kích hoạt AI.`
              );
            } else if (text === "/agent status" || text === "trạng thái agent") {
              const state = loadWatchdogState();
              await sendTelegramMessage(
                `📊 <b>TRẠNG THÁI WATCHDOG AGENT</b>\n• <b>Trạng thái:</b> ${state.enabled ? "🟢 ĐANG BẬT" : "🔴 ĐÃ TẮT"}\n• <b>AI Model:</b> ${state.model}\n• <b>Tổng sự cố ghi nhận:</b> ${state.totalIncidents}\n• <b>Số lần vá thành công:</b> ${state.totalPatchesApplied}\n• <b>Gần nhất:</b> ${state.lastIncidentAt || "Chưa có"}`
              );
            } else if (text === "/agent help") {
              await sendTelegramMessage(
                `📖 <b>HƯỚNG DẪN LỆNH WATCHDOG AGENT:</b>\n• <code>/agent on</code>: Bật agent\n• <code>/agent off</code>: Tắt agent\n• <code>/agent status</code>: Kiểm tra trạng thái hoạt động`
              );
            }
          }
        }
      }
    } catch {
      // Giữ polling ổn định
    } finally {
      setTimeout(pollUpdates, 4000);
    }
  };

  void pollUpdates();
}
