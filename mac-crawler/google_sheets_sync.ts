import { createSign } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

export interface DiscrepancyRow {
  store: string;
  sku: string;
  asin: string;
  shipment_id: string;
  amazon_received: number;
  so_luong_amazon_nhan: number;
  discrepancy: number;
  receiving_date: string;
  status: string;
}

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function getServiceAccountAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheetId =
    process.env.SHIPMENT_DISCREPANCY_SPREADSHEET_ID?.trim() ||
    "1afKbqt5Bg1dhLV8oAaXE9Ti-sxOlCAxmB8hvihy2lp8";
  return { email, key, spreadsheetId };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(email: string, key: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
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
  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    throw new Error(`Google Auth Failed: ${data.error_description || res.status}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

interface ManualNote {
  caseId: string;
  statusXuLy: string;
  ghiChu: string;
}

export async function syncDiscrepanciesToGoogleSheet(
  allRows: DiscrepancyRow[],
  storeList: string[]
): Promise<string> {
  const { email, key, spreadsheetId } = getServiceAccountAuth();
  if (!email || !key || !spreadsheetId) {
    console.warn("[GoogleSheet] Bỏ qua sync Google Sheet vì thiếu credentials hoặc SPREADSHEET_ID.");
    return "";
  }

  console.log(`\n===============================================================`);
  console.log(`🌐 ĐANG ĐỒNG BỘ DỮ LIỆU ĐỐI SOÁT LÊN GOOGLE SHEET MASTER...`);
  console.log(`  - Spreadsheet ID: ${spreadsheetId}`);

  const token = await getAccessToken(email, key);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // 1. Lấy thông tin cấu trúc Spreadsheet hiện tại
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { headers });
  const meta = await metaRes.json();
  if (!metaRes.ok || meta.error) {
    throw new Error(`Lỗi đọc metadata Google Sheet: ${meta.error?.message || metaRes.statusText}`);
  }

  const existingSheets: Array<{ sheetId: number; title: string }> =
    meta.sheets?.map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
    })) || [];

  const existingSheetMap = new Map(existingSheets.map((s) => [s.title, s.sheetId]));

  // 2. Thu thập các ghi chú thủ công (Manual Notes) đã nhập từ trước để không bị mất khi bot update
  const notesMap = new Map<string, ManualNote>();

  for (const sheet of existingSheets) {
    try {
      const readRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          sheet.title
        )}!A2:L2000`,
        { headers }
      );
      if (readRes.ok) {
        const valData = await readRes.json();
        const rows: any[][] = valData.values || [];
        const isMaster = sheet.title === "Tất Cả";

        for (const row of rows) {
          // Với tab Tất Cả: SKU = col B (idx 1), Shipment ID = col D (idx 3), Case = J (idx 9), Status = K (idx 10), Note = L (idx 11)
          // Với tab Store: SKU = col A (idx 0), Shipment ID = col C (idx 2), Case = J (idx 9), Status = K (idx 10), Note = L (idx 11)
          const sku = String(row[isMaster ? 1 : 0] || "").trim();
          const shipmentId = String(row[isMaster ? 3 : 2] || "").trim();
          const caseId = String(row[9] || "").trim();
          const statusXuLy = String(row[10] || "").trim();
          const ghiChu = String(row[11] || "").trim();

          if (shipmentId && sku && (caseId || statusXuLy || ghiChu)) {
            const key = `${sheet.title}:${shipmentId}:${sku}`;
            notesMap.set(key, { caseId, statusXuLy, ghiChu });
          }
        }
      }
    } catch (e: any) {
      console.warn(`[GoogleSheet] Không đọc được notes cũ từ tab "${sheet.title}": ${e.message}`);
    }
  }

  // 3. Đảm bảo có đủ các Tab: "Tất Cả" và từng Store trong storeList
  const targetSheets = ["Tất Cả", ...storeList];
  const requests: any[] = [];

  // Nếu sheet chỉ có "Sheet1", đổi tên "Sheet1" thành "Tất Cả"
  if (existingSheets.length === 1 && existingSheets[0].title === "Sheet1") {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: existingSheets[0].sheetId,
          title: "Tất Cả",
        },
        fields: "title",
      },
    });
    existingSheetMap.delete("Sheet1");
    existingSheetMap.set("Tất Cả", existingSheets[0].sheetId);
  }

  // Tạo các sheet còn thiếu
  for (const t of targetSheets) {
    if (!existingSheetMap.has(t)) {
      requests.push({
        addSheet: {
          properties: {
            title: t,
            gridProperties: { rowCount: 1000, columnCount: 15, frozenRowCount: 1 },
          },
        },
      });
    }
  }

  if (requests.length > 0) {
    const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests }),
    });
    if (!batchRes.ok) {
      const err = await batchRes.json();
      console.warn(`[GoogleSheet] Cảnh báo tạo sheet: ${err.error?.message}`);
    }
  }

  // 4. Chuẩn bị dữ liệu ghi vào từng sheet
  const valueUpdates: Array<{ range: string; values: any[][] }> = [];

  // Tab Tất Cả
  {
    const masterHeaders = [
      "Store",
      "SKU",
      "ASIN",
      "Shipment ID",
      "Amazon Expected",
      "Amazon Located",
      "Discrepancy",
      "Receiving Date",
      "Status Amazon",
      "Mã Case Amazon",
      "Trạng Thái Xử Lý",
      "Ghi Chú Kế Toán",
    ];
    const masterRows: any[][] = [masterHeaders];

    for (const r of allRows) {
      const note = notesMap.get(`Tất Cả:${r.shipment_id.trim()}:${r.sku.trim()}`);
      masterRows.push([
        r.store,
        r.sku,
        r.asin,
        r.shipment_id,
        r.amazon_received,
        r.so_luong_amazon_nhan,
        r.discrepancy,
        r.receiving_date,
        r.status,
        note?.caseId || "",
        note?.statusXuLy || "",
        note?.ghiChu || "",
      ]);
    }
    valueUpdates.push({
      range: `'Tất Cả'!A1:L${masterRows.length}`,
      values: masterRows,
    });
  }

  // Từng Store
  for (const sName of storeList) {
    const storeRows = allRows.filter((r) => r.store.toUpperCase() === sName.toUpperCase());
    const storeHeaders = [
      "SKU",
      "ASIN",
      "Shipment ID",
      "Amazon Expected",
      "Amazon Located",
      "Discrepancy",
      "Receiving Date",
      "Status Amazon",
      "Mã Case Amazon",
      "Trạng Thái Xử Lý",
      "Ghi Chú Kế Toán",
    ];
    const rowsData: any[][] = [storeHeaders];

    for (const r of storeRows) {
      const note = notesMap.get(`${sName}:${r.shipment_id.trim()}:${r.sku.trim()}`);
      rowsData.push([
        r.sku,
        r.asin,
        r.shipment_id,
        r.amazon_received,
        r.so_luong_amazon_nhan,
        r.discrepancy,
        r.receiving_date,
        r.status,
        note?.caseId || "",
        note?.statusXuLy || "",
        note?.ghiChu || "",
      ]);
    }
    valueUpdates.push({
      range: `'${sName}'!A1:K${rowsData.length}`,
      values: rowsData,
    });
  }

  // 5. Clear dữ liệu cũ và ghi đè dữ liệu mới
  for (const update of valueUpdates) {
    const sheetNameMatch = update.range.match(/'([^']+)'/);
    if (sheetNameMatch) {
      const sheetName = sheetNameMatch[1];
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:L:clear`,
        {
          method: "POST",
          headers,
        }
      ).catch(() => {});
    }
  }

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: valueUpdates,
      }),
    }
  );

  if (!updateRes.ok) {
    const err = await updateRes.json();
    throw new Error(`Lỗi cập nhật dữ liệu Google Sheet: ${err.error?.message || updateRes.statusText}`);
  }

  // 6. Định dạng Header đẹp mắt (Xanh Navy #1E3A8A, Chữ Trắng, In Đậm, Cố định dòng 1)
  try {
    // Lấy lại danh sách sheetId mới nhất sau khi add
    const freshMetaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { headers });
    const freshMeta = await freshMetaRes.json();
    const currentSheets: Array<{ sheetId: number; title: string }> =
      freshMeta.sheets?.map((s: any) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
      })) || [];

    const styleRequests: any[] = [];
    for (const sh of currentSheets) {
      if (!targetSheets.includes(sh.title)) continue;
      // Freeze header row
      styleRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sh.sheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      });

      // Header style: Navy #1E3A8A, White text, Bold, Center
      styleRequests.push({
        repeatCell: {
          range: {
            sheetId: sh.sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 30 / 255, green: 58 / 255, blue: 138 / 255 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        },
      });
    }

    if (styleRequests.length > 0) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: styleRequests }),
      });
    }
  } catch (err: any) {
    console.warn(`[GoogleSheet] Lỗi định dạng giao diện Sheet: ${err.message}`);
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  console.log(`✅ ĐỒNG BỘ GOOGLE SHEET THÀNH CÔNG!`);
  console.log(`  👉 Link Sheet: ${sheetUrl}`);
  return sheetUrl;
}

