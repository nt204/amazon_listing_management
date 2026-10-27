import "server-only";

import { createSign } from "node:crypto";
import { ApiError } from "@/lib/api-guard";

// Đọc Google Sheet bằng service account (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY trong .env).
// Sheet phải được chia sẻ quyền "Người xem" cho email service account.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function getServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const email = getServiceAccountEmail();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error("Chưa cấu hình Google service account (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).");
  }

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Không đăng nhập được Google: ${data.error_description || res.status}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Lấy spreadsheetId từ link dạng https://docs.google.com/spreadsheets/d/<id>/edit#gid=... */
export function parseSpreadsheetId(url: string): string | null {
  const match = url.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}

async function sheetsGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 404) {
    throw new ApiError(
      `Không mở được Google Sheet. Hãy chia sẻ sheet (quyền Người xem) cho ${getServiceAccountEmail()} rồi thử lại.`,
      400,
    );
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google Sheets lỗi: ${data.error?.message || res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Đọc toàn bộ 1 tab. pickTab nhận danh sách tên tab và trả về tab cần đọc.
 * Giá trị số trả về dạng số thô (15% → 0.15). Ô ngày trả về serial number của Google
 * (không dùng chữ hiển thị vì sheet ghi lẫn d/m/y và m/d/y) — đổi bằng sheetSerialToIsoDate.
 */
export async function readSpreadsheetTab(
  url: string,
  pickTab: (titles: string[]) => string | null,
): Promise<{ spreadsheetTitle: string; tabTitle: string; rows: (string | number | null)[][] }> {
  const spreadsheetId = parseSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new ApiError("Link không phải Google Sheet hợp lệ (cần dạng docs.google.com/spreadsheets/d/...).", 400);
  }

  const meta = await sheetsGet<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    `${spreadsheetId}?fields=properties.title,sheets.properties.title`,
  );
  const titles = meta.sheets.map((sheet) => sheet.properties.title);
  const tabTitle = pickTab(titles);
  if (!tabTitle) {
    throw new ApiError(
      `Không tìm thấy tab phù hợp trong sheet "${meta.properties.title}". Các tab hiện có: ${titles.join(", ")}`,
      400,
    );
  }

  const range = encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'`);
  const values = await sheetsGet<{ values?: (string | number | boolean)[][] }>(
    `${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  const rows = (values.values ?? []).map((row) =>
    row.map((cell) => (cell === "" || typeof cell === "boolean" ? (cell === "" ? null : String(cell)) : cell)),
  );
  return { spreadsheetTitle: meta.properties.title, tabTitle, rows };
}
