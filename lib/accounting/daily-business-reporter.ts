import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import sharp from "sharp";
import {
  notifyLarkEventBestEffort,
  sendLarkCardNotification,
  uploadLarkImage,
} from "@/lib/lark-notifications";

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "$0";
  const isNegative = val < 0;
  const abs = Math.abs(val);
  const rounded = Math.round(abs);
  const formatted = new Intl.NumberFormat("en-US").format(rounded);
  return isNegative ? `-$${formatted}` : `$${formatted}`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function formatQuantity(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(val));
}

export function generateDailyReportSvg(
  date: string,
  reports: Array<{ storeName: string; item: FbaDailyItem }>,
): string {
  const totalRev = reports.reduce((sum, r) => sum + Number(r.item.revenue || 0), 0);
  const totalQty = reports.reduce((sum, r) => sum + Number(r.item.quantity || 0), 0);
  const totalAds = reports.reduce((sum, r) => sum + Number(r.item.ads_fee || 0), 0);
  const totalAmz = reports.reduce((sum, r) => sum + Number(r.item.amazon_fee || 0), 0);
  const totalRefund = reports.reduce((sum, r) => sum + Number(r.item.return_cost || 0), 0);
  const totalProfit = reports.reduce((sum, r) => sum + Number(r.item.profit || 0), 0);

  // Layout: 965px total width with minimal 1.5px border padding (pure edge-to-edge table)
  const pad = 1.5;
  const colWidths = [200, 135, 125, 125, 130, 115, 135];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 965
  const totalWidth = tableWidth + pad * 2;

  const headerHeight = 64;
  const rowHeight = 62;
  const totalRowHeight = 68;
  const tableHeight = headerHeight + reports.length * rowHeight + totalRowHeight;
  const totalHeight = tableHeight + pad * 2;

  const colX: number[] = [];
  let currX = pad;
  for (const w of colWidths) {
    colX.push(currX);
    currX += w;
  }

  // Vertical divider lines
  let vLinesSvg = "";
  for (let i = 1; i < colWidths.length; i++) {
    const x = colX[i];
    vLinesSvg += `<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad + tableHeight}" stroke="#cbd5e1" stroke-width="1.5"/>`;
  }

  const headers = ["Store", "Revenue", "Quantity", "Ads Fee", "AMZ Fee", "Refund", "Profit"];
  let headerCellsSvg = "";
  headers.forEach((h, i) => {
    const x = i === 0 ? colX[i] + 16 : colX[i] + colWidths[i] - 16;
    const anchor = i === 0 ? "start" : "end";
    headerCellsSvg += `<text x="${x}" y="${pad + 41}" text-anchor="${anchor}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="700" fill="#0f172a">${h}</text>`;
  });

  let rowsSvg = "";
  reports.forEach((r, idx) => {
    const it = r.item;
    const y = pad + headerHeight + idx * rowHeight;
    rowsSvg += `
      <line x1="${pad}" y1="${y}" x2="${pad + tableWidth}" y2="${y}" stroke="#e2e8f0" stroke-width="1.5"/>
      <text x="${colX[0] + 16}" y="${y + 40}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="600" fill="#1e293b">${escapeXml(r.storeName)}</text>
      <text x="${colX[1] + colWidths[1] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="500" fill="#1e293b">${formatCurrency(it.revenue)}</text>
      <text x="${colX[2] + colWidths[2] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="500" fill="#1e293b">${formatQuantity(it.quantity)}</text>
      <text x="${colX[3] + colWidths[3] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="500" fill="#1e293b">${formatCurrency(it.ads_fee)}</text>
      <text x="${colX[4] + colWidths[4] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="500" fill="#1e293b">${formatCurrency(it.amazon_fee)}</text>
      <text x="${colX[5] + colWidths[5] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="500" fill="#1e293b">${formatCurrency(it.return_cost)}</text>
      <text x="${colX[6] + colWidths[6] - 16}" y="${y + 40}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="800" fill="#0f172a">${formatCurrency(it.profit)}</text>
    `;
  });

  const totalY = pad + headerHeight + reports.length * rowHeight;
  rowsSvg += `
    <line x1="${pad}" y1="${totalY}" x2="${pad + tableWidth}" y2="${totalY}" stroke="#94a3b8" stroke-width="2.5"/>
    <text x="${colX[0] + 16}" y="${totalY + 43}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">TỔNG CỘNG</text>
    <text x="${colX[1] + colWidths[1] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatCurrency(totalRev)}</text>
    <text x="${colX[2] + colWidths[2] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatQuantity(totalQty)}</text>
    <text x="${colX[3] + colWidths[3] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatCurrency(totalAds)}</text>
    <text x="${colX[4] + colWidths[4] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatCurrency(totalAmz)}</text>
    <text x="${colX[5] + colWidths[5] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatCurrency(totalRefund)}</text>
    <text x="${colX[6] + colWidths[6] - 16}" y="${totalY + 43}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="24" font-weight="900" fill="#0f172a">${formatCurrency(totalProfit)}</text>
  `;

  return `
  <svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad}" y="${pad}" width="${tableWidth}" height="${tableHeight}" rx="10" fill="#FFFFFF" stroke="#cbd5e1" stroke-width="1.5"/>

    <defs>
      <clipPath id="tableClip">
        <rect x="${pad}" y="${pad}" width="${tableWidth}" height="${tableHeight}" rx="10"/>
      </clipPath>
    </defs>

    <g clip-path="url(#tableClip)">
      <rect x="${pad}" y="${pad}" width="${tableWidth}" height="${headerHeight}" fill="#F8FAFC"/>
      <line x1="${pad}" y1="${pad + headerHeight}" x2="${pad + tableWidth}" y2="${pad + headerHeight}" stroke="#cbd5e1" stroke-width="2"/>
      ${vLinesSvg}
      ${headerCellsSvg}
      ${rowsSvg}
    </g>
  </svg>
  `;
}

export async function generateDailyReportImage(
  date: string,
  reports: Array<{ storeName: string; item: FbaDailyItem }>,
): Promise<Buffer> {
  const svg = generateDailyReportSvg(date, reports);
  // Render at 3x retina resolution (density: 216) for crystal-clear text sharpness
  return await sharp(Buffer.from(svg), { density: 216 }).png().toBuffer();
}


/** Store có đơn trong N ngày gần nhất mới tính là "đang hoạt động". */
const ACTIVE_STORE_WINDOW_DAYS = 7;
/** Số ngày trước ngày báo cáo dùng làm mốc so sánh. */
const BASELINE_DAYS = 7;
const AI_COMMENTARY_TIMEOUT_MS = 20_000;

type ReportRecipient = { receiveId: string; receiveIdType: string };

export interface DailyBaseline {
  days: number;
  revenue: number;
  quantity: number;
  ads_fee: number;
  return_cost: number;
  profit: number;
}

export interface DailyStoreReport {
  storeName: string;
  item: FbaDailyItem;
  baseline: DailyBaseline | null;
}

export interface DailyReportPreview {
  card: Record<string, unknown>;
  fallbackText: string;
  highlights: string[];
  commentary: string | null;
  image: Buffer | null;
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function emptyDailyItem(date: string): FbaDailyItem {
  return {
    id: date, date, week: "", month: "",
    revenue: 0, quantity: 0, orders: 0, ads_fee: 0, basecost: 0, amazon_fee: 0, thue: 0,
    promotion: 0, return_cost: 0, profit: 0, net_profit: 0, balance: 0, roi: 0, tacos: 0,
    acos: 0, margin: 0, margin_pre_ads: 0, profit_per_item: 0, revenue_ads: 0, quantity_ads: 0, clicks: 0,
  };
}

function pctChange(value: number, base: number): number {
  return ((value - base) / Math.abs(base)) * 100;
}

function tacosPct(ads: number, revenue: number): number | null {
  return revenue > 0 ? (ads / revenue) * 100 : null;
}

/**
 * So sánh ngày báo cáo với trung bình 7 ngày trước, chỉ giữ biến động đáng kể.
 * Toàn bộ con số được tính ở đây; AI (nếu bật) chỉ diễn đạt lại.
 */
export function buildDailyHighlights(reports: DailyStoreReport[]): string[] {
  const lines: string[] = [];
  for (const { storeName, item, baseline } of reports) {
    if (!baseline || baseline.days < 3) continue;
    const revenue = Number(item.revenue || 0);
    const ads = Number(item.ads_fee || 0);
    const refund = Number(item.return_cost || 0);
    const profit = Number(item.profit || 0);

    // Ads = 0 trong khi các ngày trước có chạy: nhiều khả năng file Ads chưa nạp,
    // nên không kết luận gì về profit/TACOS để tránh báo sai.
    const adsMissing = ads === 0 && baseline.ads_fee >= 20;
    if (adsMissing) {
      lines.push(`${storeName}: chưa có chi phí Ads (TB ${formatCurrency(baseline.ads_fee)}/ngày) — có thể chưa nạp file Ads, Profit đang cao hơn thực tế.`);
    }

    if (baseline.revenue >= 100 && Math.abs(revenue - baseline.revenue) >= 100) {
      const change = pctChange(revenue, baseline.revenue);
      if (Math.abs(change) >= 30) {
        lines.push(`${storeName}: Revenue ${formatCurrency(revenue)}, ${change > 0 ? "tăng" : "giảm"} ${Math.abs(Math.round(change))}% so với TB 7 ngày (${formatCurrency(baseline.revenue)}).`);
      }
    }

    if (!adsMissing) {
      if (profit < 0) {
        // Store lỗ triền miên không cần nhắc mỗi ngày: chỉ báo khi chuyển sang lỗ hoặc lỗ sâu thêm
        if (baseline.profit >= 0 || profit <= baseline.profit - 100) lines.push(`${storeName}: lỗ ${formatCurrency(Math.abs(profit))} (TB 7 ngày ${formatCurrency(baseline.profit)}).`);
      } else if (Math.abs(profit - baseline.profit) >= 100 && baseline.profit !== 0) {
        const change = pctChange(profit, baseline.profit);
        if (Math.abs(change) >= 40) {
          lines.push(`${storeName}: Profit ${formatCurrency(profit)}, ${change > 0 ? "tăng" : "giảm"} ${Math.abs(Math.round(change))}% so với TB 7 ngày (${formatCurrency(baseline.profit)}).`);
        }
      }

      const tacos = tacosPct(ads, revenue);
      const baseTacos = tacosPct(baseline.ads_fee, baseline.revenue);
      if (tacos != null && baseTacos != null && ads >= 20 && baseline.ads_fee >= 20 && tacos - baseTacos >= 5) {
        lines.push(`${storeName}: TACOS ${tacos.toFixed(1)}% (TB 7 ngày ${baseTacos.toFixed(1)}%), Ads ${formatCurrency(ads)}.`);
      }
    }

    if (refund >= 50 && refund >= baseline.return_cost * 2) {
      lines.push(`${storeName}: Refund ${formatCurrency(refund)}, gấp ${baseline.return_cost > 0 ? (refund / baseline.return_cost).toFixed(1) : "nhiều"} lần TB 7 ngày (${formatCurrency(baseline.return_cost)}).`);
    }
  }
  return lines;
}

const AI_COMMENTARY_SYSTEM_PROMPT = `Bạn là trợ lý kế toán viết phần "Nhận xét" ngắn cho báo cáo kinh doanh FBA hằng ngày gửi nhóm qua Lark.
Quy tắc:
- Viết tiếng Việt, giọng ngắn gọn, thẳng vào việc, không chào hỏi, không kết luận chung chung.
- Tối đa 4 gạch đầu dòng (bắt đầu bằng "- "), mỗi dòng tối đa 30 chữ. Gộp các ý cùng store.
- Chỉ dùng con số có trong dữ liệu được cung cấp, không tự tính số mới, không dự báo.
- Ưu tiên "DIEM_DANG_CHU_Y"; mỗi ý nêu hiện tượng rồi gợi ý việc cần kiểm tra (campaign, listing, tồn kho, file chưa nạp...).
- Nếu store bị ghi "chưa có chi phí Ads" thì không nhận xét về Profit/TACOS của store đó.
- Nếu DIEM_DANG_CHU_Y rỗng, chỉ trả về đúng câu: "Không có biến động đáng kể so với 7 ngày trước."
- Không dùng tiêu đề, không dùng bảng, không in đậm.`;

async function generateAiCommentary(
  displayDate: string,
  reports: DailyStoreReport[],
  highlights: string[],
): Promise<string | null> {
  const apiKey = (process.env.LARK_AGENT_KEY || process.env.CHEAPKEYAI_API_KEY || "").trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.LARK_AGENT_BASE_URL || "https://cheapkeyai.shop/v1").replace(/\/+$/, "");
  const model = (process.env.LARK_AGENT_MODEL || "gemini-3.5-flash-lite").trim();

  const data = {
    NGAY: displayDate,
    STORES: reports.map(({ storeName, item, baseline }) => ({
      store: storeName,
      revenue: formatCurrency(item.revenue),
      quantity: formatQuantity(item.quantity),
      ads_fee: formatCurrency(item.ads_fee),
      refund: formatCurrency(item.return_cost),
      profit: formatCurrency(item.profit),
      tb_7_ngay: baseline
        ? {
            revenue: formatCurrency(baseline.revenue),
            ads_fee: formatCurrency(baseline.ads_fee),
            profit: formatCurrency(baseline.profit),
          }
        : null,
    })),
    DIEM_DANG_CHU_Y: highlights,
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: AI_COMMENTARY_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(data) },
        ],
      }),
      signal: AbortSignal.timeout(AI_COMMENTARY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI API lỗi (${response.status})`);
    const body = await response.json();
    const text = String(body?.choices?.[0]?.message?.content || "").trim();
    return text ? text.slice(0, 1500) : null;
  } catch (err) {
    console.warn("[Accounting Report] Không tạo được nhận xét AI, gửi báo cáo không kèm nhận xét:", err);
    return null;
  }
}

function aiCommentaryEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  return process.env.DAILY_REPORT_AI_COMMENTARY?.trim().toLowerCase() === "true";
}

export async function reportDailyBusinessData(
  scope: DataScope,
  options: {
    force?: boolean;
    targetDate?: string;
    recipient?: ReportRecipient;
    /** Ghi đè cờ DAILY_REPORT_AI_COMMENTARY. */
    aiCommentary?: boolean;
    /** Chỉ dựng nội dung để xem trước: không upload, không gửi, không ghi app_settings. */
    dryRun?: boolean;
  } = {},
): Promise<{ success: boolean; reportedDate: string | null; message: string; preview?: DailyReportPreview }> {
  const sql = await getDatabaseClient();
  const isAutomatic = !options.force && !options.recipient && !options.dryRun;

  let latestDate = options.targetDate?.trim();

  // 1. Không chỉ định ngày: lấy ngày mới nhất (< hôm nay) mà mọi store ĐANG HOẠT ĐỘNG
  //    (có đơn trong 7 ngày gần nhất) đều đã có đơn. Store ngừng nạp dữ liệu không chặn báo cáo.
  if (!latestDate) {
    const completeDateRows = await sql<Array<{ latest_date: string }>>`
      WITH active AS (
        SELECT DISTINCT store_id FROM accounting_orders
        WHERE date IS NOT NULL AND date < CURRENT_DATE
          AND date > (SELECT MAX(date) FROM accounting_orders WHERE date < CURRENT_DATE) - ${ACTIVE_STORE_WINDOW_DAYS}::int
      )
      SELECT o.date::text AS latest_date
      FROM accounting_orders o
      JOIN active a ON a.store_id = o.store_id
      WHERE o.date < CURRENT_DATE
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY o.date
      HAVING COUNT(DISTINCT o.store_id) = (SELECT COUNT(*) FROM active)
      ORDER BY o.date DESC
      LIMIT 1
    `;
    latestDate = completeDateRows[0]?.latest_date;
  }

  if (!latestDate) {
    return {
      success: false,
      reportedDate: null,
      message: "Chưa có ngày nào hoàn tất đầy đủ dữ liệu cho tất cả các Store đang hoạt động.",
    };
  }

  // 2. Kiểm tra nhanh đã báo cáo ngày này (hoặc ngày mới hơn) chưa
  const settingKey = `lark_accounting_last_reported_date:${scope.teamId}`;
  if (isAutomatic) {
    const settingRows = await sql<Array<{ value: string }>>`
      SELECT value FROM app_settings
      WHERE key = ${settingKey}
      LIMIT 1
    `;
    const rawVal = settingRows[0]?.value;
    let lastReportedDate = "";
    try {
      lastReportedDate = rawVal ? JSON.parse(rawVal)?.date : "";
    } catch {
      lastReportedDate = rawVal || "";
    }
    if (lastReportedDate && lastReportedDate >= latestDate) {
      return {
        success: true,
        reportedDate: latestDate,
        message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.`,
      };
    }
  }

  // 3. Store đang hoạt động tính đến ngày báo cáo
  const activeFrom = shiftIsoDate(latestDate, -(ACTIVE_STORE_WINDOW_DAYS - 1));
  const storeRows = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM stores
    WHERE EXISTS (
      SELECT 1 FROM accounting_orders o
      WHERE o.store_id = stores.id AND o.date BETWEEN ${activeFrom}::date AND ${latestDate}::date
    )
    ORDER BY name ASC
  `;

  if (!storeRows.length) {
    return { success: false, reportedDate: latestDate, message: `Không có store nào có đơn trong 7 ngày tính đến ${latestDate}.` };
  }

  // 4. Số liệu ngày báo cáo + trung bình 7 ngày trước cho từng store
  const baselineFrom = shiftIsoDate(latestDate, -BASELINE_DAYS);
  const reports: DailyStoreReport[] = [];
  for (const store of storeRows) {
    try {
      const { items } = await listFbaDaily(store.id, {
        startDate: baselineFrom,
        endDate: latestDate,
        limit: BASELINE_DAYS + 1,
      });
      const item = items.find((row) => row.date === latestDate) ?? emptyDailyItem(latestDate);
      const previous = items.filter((row) => row.date < latestDate);
      const avg = (pick: (row: FbaDailyItem) => number) =>
        previous.reduce((sum, row) => sum + Number(pick(row) || 0), 0) / previous.length;
      const baseline: DailyBaseline | null = previous.length
        ? {
            days: previous.length,
            revenue: avg((row) => row.revenue),
            quantity: avg((row) => row.quantity),
            ads_fee: avg((row) => row.ads_fee),
            return_cost: avg((row) => row.return_cost),
            profit: avg((row) => row.profit),
          }
        : null;
      reports.push({ storeName: store.name, item, baseline });
    } catch (err) {
      console.warn(`[Accounting Report] Không thể lấy dữ liệu store ${store.name}:`, err);
    }
  }

  if (reports.length === 0) {
    return { success: false, reportedDate: latestDate, message: `Không có dữ liệu kinh doanh cho ngày ${latestDate}.` };
  }

  const sum = (pick: (it: FbaDailyItem) => number) => reports.reduce((total, r) => total + Number(pick(r.item) || 0), 0);
  const totalRev = sum((it) => it.revenue);
  const totalQty = sum((it) => it.quantity);
  const totalAds = sum((it) => it.ads_fee);
  const totalAmzFee = sum((it) => it.amazon_fee);
  const totalRefund = sum((it) => it.return_cost);
  const totalProfit = sum((it) => it.profit);

  const parts = latestDate.split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : latestDate;

  // 5. Nhận xét: điểm đáng chú ý do code tính; AI (nếu bật) diễn đạt lại, lỗi thì dùng bản của code
  const highlights = buildDailyHighlights(reports);
  const commentary = aiCommentaryEnabled(options.aiCommentary)
    ? await generateAiCommentary(displayDate, reports, highlights)
    : null;
  const notesTitle = commentary ? "Nhận xét" : "Điểm đáng chú ý (so với TB 7 ngày trước)";
  const notesBody = commentary
    ?? (highlights.length ? highlights.map((line) => `- ${line}`).join("\n") : "Không có biến động đáng kể so với 7 ngày trước.");

  // 6. Chống gửi trùng khi nhiều lần import kết thúc cùng lúc: chiếm ngày báo cáo trước khi gửi
  if (isAutomatic) {
    const claimed = await sql<Array<{ key: string }>>`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${settingKey}, ${JSON.stringify({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      WHERE COALESCE(
        CASE WHEN app_settings.value ~ '^\\s*\\{' THEN app_settings.value::jsonb ->> 'date' ELSE app_settings.value END,
        ''
      ) < ${latestDate}
      RETURNING key
    `;
    if (!claimed.length) {
      return { success: true, reportedDate: latestDate, message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.` };
    }
  }

  // 7. Render bảng ra ảnh và upload lên Lark
  let image: Buffer | null = null;
  let imageKey: string | null = null;
  try {
    image = await generateDailyReportImage(latestDate, reports);
    if (!options.dryRun) imageKey = await uploadLarkImage(image, `fba-daily-${latestDate}.png`);
  } catch (err) {
    console.warn("[Accounting Report] Không thể tạo hoặc upload ảnh bảng báo cáo:", err);
  }
  if (options.dryRun && image) imageKey = "<preview>";

  // Soạn nội dung thông báo bot Lark dạng Card 2.0 (ưu tiên hiển thị bảng ảnh trực quan)
  const cardElements: Array<Record<string, unknown>> = [];
  if (imageKey) {
    cardElements.push({
      tag: "img",
      img_key: imageKey,
      alt: {
        tag: "plain_text",
        content: `Báo cáo Kinh doanh FBA Ngày ${displayDate}`,
      },
      mode: "fit_horizontal",
    });
  } else {
    // Fallback sang table element nếu không tạo được ảnh
    cardElements.push({
      tag: "table",
      page_size: Math.max(10, reports.length + 2),
      row_height: "low",
      freeze_first_column: false,
      header_style: {
        text_align: "left",
        text_size: "normal",
        background_style: "grey",
        bold: true,
        lines: 1,
      },
      columns: [
        { name: "store", display_name: "Store", data_type: "lark_md", horizontal_align: "left", width: "20%" },
        { name: "revenue", display_name: "Revenue", data_type: "lark_md", horizontal_align: "right", width: "13%" },
        { name: "quantity", display_name: "Quantity", data_type: "lark_md", horizontal_align: "right", width: "12%" },
        { name: "ads_fee", display_name: "Ads Fee", data_type: "lark_md", horizontal_align: "right", width: "13%" },
        { name: "amz_fee", display_name: "AMZ Fee", data_type: "lark_md", horizontal_align: "right", width: "13%" },
        { name: "refund", display_name: "Refund", data_type: "lark_md", horizontal_align: "right", width: "13%" },
        { name: "profit", display_name: "Profit", data_type: "lark_md", horizontal_align: "right", width: "16%" },
      ],
      rows: [
        ...reports.map((r) => {
          const it = r.item;
          return {
            store: `${r.storeName}`,
            revenue: formatCurrency(it.revenue),
            quantity: formatQuantity(it.quantity),
            ads_fee: formatCurrency(it.ads_fee),
            amz_fee: formatCurrency(it.amazon_fee),
            refund: formatCurrency(it.return_cost),
            profit: `**${formatCurrency(it.profit)}**`,
          };
        }),
        {
          store: "**TỔNG CỘNG**",
          revenue: `**${formatCurrency(totalRev)}**`,
          quantity: `**${formatQuantity(totalQty)}**`,
          ads_fee: `**${formatCurrency(totalAds)}**`,
          amz_fee: `**${formatCurrency(totalAmzFee)}**`,
          refund: `**${formatCurrency(totalRefund)}**`,
          profit: `**${formatCurrency(totalProfit)}**`,
        },
      ],
    });
  }

  cardElements.push({ tag: "hr" });
  cardElements.push({ tag: "markdown", content: `**${notesTitle}**\n${notesBody}` });

  const card = {
    schema: "2.0",
    config: {
      width_mode: "fill",
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `Báo cáo Kinh doanh FBA Ngày ${displayDate}`,
      },
    },
    body: {
      elements: cardElements,
    },
  };

  const fallbackLines = [
    `Báo cáo Kinh doanh FBA Ngày ${displayDate}`,
    `Store | Revenue | Quantity | Ads Fee | AMZ Fee | Refund | Profit`,
    ...reports.map((r) => {
      const it = r.item;
      return `${r.storeName} | ${formatCurrency(it.revenue)} | ${formatQuantity(it.quantity)} | ${formatCurrency(it.ads_fee)} | ${formatCurrency(it.amazon_fee)} | ${formatCurrency(it.return_cost)} | ${formatCurrency(it.profit)}`;
    }),
    `TỔNG CỘNG | ${formatCurrency(totalRev)} | ${formatQuantity(totalQty)} | ${formatCurrency(totalAds)} | ${formatCurrency(totalAmzFee)} | ${formatCurrency(totalRefund)} | ${formatCurrency(totalProfit)}`,
    "",
    notesTitle,
    notesBody,
  ];

  if (options.dryRun) {
    return {
      success: true,
      reportedDate: latestDate,
      message: `Xem trước báo cáo ngày ${displayDate} cho ${reports.length} Store (chưa gửi).`,
      preview: { card, fallbackText: fallbackLines.join("\n"), highlights, commentary, image },
    };
  }

  // 8. Gửi thông báo Lark bot: Gửi Card 2.0 toàn màn hình chứa ảnh bảng tràn viền (kích thước lớn nhất, sắc nét nhất)
  if (options.recipient) {
    await sendLarkCardNotification(card, options.recipient);
  } else {
    await notifyLarkEventBestEffort(
      { teamId: scope.teamId, actorId: "system" },
      "accounting",
      {
        card,
        fallbackText: fallbackLines.join("\n"),
      },
    );
  }

  if (options.force && !options.recipient) {
    // Gửi ép (force) không đi qua bước chiếm ngày ở trên nên ghi lại ngày đã báo cáo ở đây
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${settingKey}, ${JSON.stringify({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value, updated_at = NOW()
    `;
  }

  return {
    success: true,
    reportedDate: latestDate,
    message: `Đã gửi báo cáo kinh doanh ngày ${displayDate} cho ${reports.length} Store qua Lark bot.`,
  };
}

/**
 * Tự động kích hoạt kiểm tra và gửi báo cáo kinh doanh ngày qua Lark sau mỗi lần nạp file đơn hàng / dữ liệu.
 * Chạy bất đồng bộ an toàn (best-effort), không làm chậm hoặc lỗi luồng nạp file chính.
 */
export async function triggerDailyReportCheckAfterImport(teamId: string = "default"): Promise<void> {
  try {
    const scope: DataScope = { teamId, actorId: "system" };
    const result = await reportDailyBusinessData(scope);
    if (result.success && result.reportedDate) {
      console.log(`[Auto Daily Report] Đã tự động gửi báo cáo ngày ${result.reportedDate} qua Lark: ${result.message}`);
    } else {
      console.log(`[Auto Daily Report] Kiểm tra sau import: ${result.message}`);
    }
  } catch (err) {
    console.warn("[Auto Daily Report] Lỗi khi tự động kích hoạt báo cáo kế toán:", err);
  }
}

