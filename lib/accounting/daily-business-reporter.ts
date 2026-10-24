import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import sharp from "sharp";
import {
  notifyLarkEventBestEffort,
  sendLarkCardNotification,
  sendLarkImageNotification,
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

  const parts = date.split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;

  const margin = 20;
  const colWidths = [180, 115, 105, 115, 115, 105, 125];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const totalWidth = tableWidth + margin * 2;

  const titleHeight = 56;
  const tableStartY = margin + titleHeight;

  const headerHeight = 44;
  const rowHeight = 42;
  const totalRows = reports.length + 1;
  const tableHeight = headerHeight + totalRows * rowHeight;
  const totalHeight = tableStartY + tableHeight + margin;

  const colX: number[] = [];
  let currX = margin;
  for (const w of colWidths) {
    colX.push(currX);
    currX += w;
  }

  let vLinesSvg = "";
  for (let i = 1; i < colWidths.length; i++) {
    const x = colX[i];
    vLinesSvg += `<line x1="${x}" y1="${tableStartY}" x2="${x}" y2="${tableStartY + tableHeight}" stroke="#e2e8f0" stroke-width="1"/>`;
  }

  const headers = ["Store", "Revenue", "Quantity", "Ads Fee", "AMZ Fee", "Refund", "Profit"];
  let headerCellsSvg = "";
  headers.forEach((h, i) => {
    const x = i === 0 ? colX[i] + 16 : colX[i] + colWidths[i] - 16;
    const anchor = i === 0 ? "start" : "end";
    headerCellsSvg += `<text x="${x}" y="${tableStartY + 28}" text-anchor="${anchor}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#0f172a">${h}</text>`;
  });

  let rowsSvg = "";
  reports.forEach((r, idx) => {
    const it = r.item;
    const y = tableStartY + headerHeight + idx * rowHeight;
    rowsSvg += `
      <line x1="${margin}" y1="${y}" x2="${margin + tableWidth}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
      <text x="${colX[0] + 16}" y="${y + 26}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="500" fill="#1e293b">${r.storeName}</text>
      <text x="${colX[1] + colWidths[1] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="#1e293b">${formatCurrency(it.revenue)}</text>
      <text x="${colX[2] + colWidths[2] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="#1e293b">${formatQuantity(it.quantity)}</text>
      <text x="${colX[3] + colWidths[3] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="#1e293b">${formatCurrency(it.ads_fee)}</text>
      <text x="${colX[4] + colWidths[4] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="#1e293b">${formatCurrency(it.amazon_fee)}</text>
      <text x="${colX[5] + colWidths[5] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="#1e293b">${formatCurrency(it.return_cost)}</text>
      <text x="${colX[6] + colWidths[6] - 16}" y="${y + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#0f172a">${formatCurrency(it.profit)}</text>
    `;
  });

  const totalY = tableStartY + headerHeight + reports.length * rowHeight;
  rowsSvg += `
    <line x1="${margin}" y1="${totalY}" x2="${margin + tableWidth}" y2="${totalY}" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="${colX[0] + 16}" y="${totalY + 26}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">TỔNG CỘNG</text>
    <text x="${colX[1] + colWidths[1] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatCurrency(totalRev)}</text>
    <text x="${colX[2] + colWidths[2] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatQuantity(totalQty)}</text>
    <text x="${colX[3] + colWidths[3] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatCurrency(totalAds)}</text>
    <text x="${colX[4] + colWidths[4] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatCurrency(totalAmz)}</text>
    <text x="${colX[5] + colWidths[5] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatCurrency(totalRefund)}</text>
    <text x="${colX[6] + colWidths[6] - 16}" y="${totalY + 26}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" fill="#0f172a">${formatCurrency(totalProfit)}</text>
  `;

  return `
  <svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${totalWidth}" height="${totalHeight}" fill="#FFFFFF"/>

    <!-- Clean Header Title -->
    <text x="${margin}" y="${margin + 26}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="18" font-weight="800" fill="#0f172a" letter-spacing="-0.3">Báo cáo Kinh doanh FBA</text>
    <text x="${margin}" y="${margin + 44}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="500" fill="#64748b">Ngày ${displayDate}</text>

    <!-- Table Container Card with rounded corners -->
    <rect x="${margin}" y="${tableStartY}" width="${tableWidth}" height="${tableHeight}" rx="8" fill="#FFFFFF" stroke="#e2e8f0" stroke-width="1.2"/>

    <defs>
      <clipPath id="tableClip">
        <rect x="${margin}" y="${tableStartY}" width="${tableWidth}" height="${tableHeight}" rx="8"/>
      </clipPath>
    </defs>

    <g clip-path="url(#tableClip)">
      <rect x="${margin}" y="${tableStartY}" width="${tableWidth}" height="${headerHeight}" fill="#F8FAFC"/>
      <line x1="${margin}" y1="${tableStartY + headerHeight}" x2="${margin + tableWidth}" y2="${tableStartY + headerHeight}" stroke="#e2e8f0" stroke-width="1.2"/>
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
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

export async function reportDailyBusinessData(
  scope: DataScope,
  options: {
    force?: boolean;
    targetDate?: string;
    recipient?: { receiveId: string; receiveIdType: string };
  } = {},
): Promise<{ success: boolean; reportedDate: string | null; message: string }> {
  const sql = await getDatabaseClient();

  let latestDate = options.targetDate?.trim();

  // 1. Nếu không chỉ định targetDate, tìm ngày mới nhất có đơn hàng trong hệ thống (< CURRENT_DATE)
  if (!latestDate) {
    const maxDateRows = await sql<Array<{ latest_date: string }>>`
      SELECT MAX(date)::text as latest_date
      FROM accounting_orders
      WHERE date IS NOT NULL AND date < CURRENT_DATE
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
    `;
    latestDate = maxDateRows[0]?.latest_date;
  }

  if (!latestDate) {
    return { success: false, reportedDate: null, message: "Chưa có dữ liệu ngày hợp lệ trong hệ thống." };
  }

  // 2. Kiểm tra xem ngày mới nhất này đã được báo cáo chưa (tránh spam lặp lại)
  const settingKey = `lark_accounting_last_reported_date:${scope.teamId}`;
  if (!options.force && !options.recipient) {
    const settingRows = await sql<Array<{ value: any }>>`
      SELECT value FROM app_settings
      WHERE key = ${settingKey}
      LIMIT 1
    `;
    const val = settingRows[0]?.value;
    const lastReportedDate = typeof val === "string" ? val : val?.date;
    if (lastReportedDate === latestDate) {
      return {
        success: true,
        reportedDate: latestDate,
        message: `Dữ liệu ngày ${latestDate} đã được báo cáo trước đó.`,
      };
    }
  }

  // 3. Lấy danh sách Store đang hoạt động
  const storeRows = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM stores
    ORDER BY name ASC
  `;

  if (!storeRows.length) {
    return { success: false, reportedDate: latestDate, message: "Không tìm thấy store nào trong hệ thống." };
  }

  // 4. Lấy các chỉ số kinh doanh ngày hôm đó cho từng store
  interface StoreReport {
    storeName: string;
    item: FbaDailyItem;
  }

  const reports: StoreReport[] = [];
  let totalRev = 0;
  let totalQty = 0;
  let totalAds = 0;
  let totalBaseCost = 0;
  let totalAmzFee = 0;
  let totalThue = 0;
  let totalPromotion = 0;
  let totalRefund = 0;
  let totalProfit = 0;

  for (const store of storeRows) {
    try {
      const { items } = await listFbaDaily(store.id, {
        startDate: latestDate,
        endDate: latestDate,
        limit: 1,
      });

      if (items.length > 0 && items[0]) {
        const item = items[0];
        reports.push({ storeName: store.name, item });
        totalRev += Number(item.revenue || 0);
        totalQty += Number(item.quantity || 0);
        totalAds += Number(item.ads_fee || 0);
        totalBaseCost += Number(item.basecost || 0);
        totalAmzFee += Number(item.amazon_fee || 0);
        totalThue += Number(item.thue || 0);
        totalPromotion += Number(item.promotion || 0);
        totalRefund += Number(item.return_cost || 0);
        totalProfit += Number(item.profit || 0);
      }
    } catch (err) {
      console.warn(`[Accounting Report] Không thể lấy dữ liệu store ${store.name}:`, err);
    }
  }

  if (reports.length === 0) {
    return { success: false, reportedDate: latestDate, message: `Không có dữ liệu kinh doanh cho ngày ${latestDate}.` };
  }

  // 5. Thử render bảng ra ảnh chất lượng cao và upload lên Lark
  let imageKey: string | null = null;
  try {
    const imgBuffer = await generateDailyReportImage(latestDate, reports);
    imageKey = await uploadLarkImage(imgBuffer, `fba-daily-${latestDate}.png`);
  } catch (err) {
    console.warn("[Accounting Report] Không thể tạo hoặc upload ảnh bảng báo cáo:", err);
  }

  const parts = latestDate.split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : latestDate;

  // Soạn nội dung thông báo bot Lark dạng Card 2.0 (ưu tiên hiển thị bảng ảnh trực quan)
  const cardElements: any[] = [];
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
  ];

  // 6. Gửi thông báo Lark bot: Ưu tiên gửi ảnh bảng (không kèm text), fallback nếu tạo ảnh lỗi
  if (imageKey) {
    if (options.recipient) {
      await sendLarkImageNotification(imageKey, options.recipient);
    } else {
      await notifyLarkEventBestEffort(scope, "accounting", {
        imageKey,
      });
    }
  } else {
    if (options.recipient) {
      await sendLarkCardNotification(card, options.recipient);
    } else {
      await notifyLarkEventBestEffort(scope, "accounting", {
        card,
        fallbackText: fallbackLines.join("\n"),
      });
    }
  }

  if (!options.recipient) {
    // 7. Lưu lại ngày đã báo cáo vào app_settings
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
