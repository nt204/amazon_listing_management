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
      <text x="${colX[0] + 16}" y="${y + 40}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="23" font-weight="600" fill="#1e293b">${r.storeName}</text>
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

  // 1. Nếu không chỉ định targetDate, tìm ngày mới nhất mà TẤT CẢ các store hoạt động đều đã hoàn tất nạp đơn hàng (< CURRENT_DATE)
  if (!latestDate) {
    const completeDateRows = await sql<Array<{ latest_date: string }>>`
      SELECT o.date::text as latest_date
      FROM accounting_orders o
      WHERE o.date IS NOT NULL AND o.date < CURRENT_DATE
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY o.date
      HAVING COUNT(DISTINCT o.store_id) >= (
        SELECT COUNT(*) FROM stores
        WHERE EXISTS (SELECT 1 FROM accounting_orders ao WHERE ao.store_id = stores.id)
      )
      ORDER BY o.date DESC
      LIMIT 1
    `;
    latestDate = completeDateRows[0]?.latest_date;
  }

  if (!latestDate) {
    return {
      success: false,
      reportedDate: null,
      message: "Chưa có ngày nào hoàn tất đầy đủ dữ liệu cho tất cả các Store trong hệ thống.",
    };
  }

  // 2. Kiểm tra xem ngày mới nhất này đã được báo cáo chưa (tránh gửi lặp lại)
  const settingKey = `lark_accounting_last_reported_date:${scope.teamId}`;
  if (!options.force && !options.recipient) {
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
    if (lastReportedDate === latestDate) {
      return {
        success: true,
        reportedDate: latestDate,
        message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.`,
      };
    }
  }

  // 3. Lấy danh sách Store kinh doanh đang hoạt động (có phát sinh đơn hàng)
  const storeRows = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM stores
    WHERE EXISTS (SELECT 1 FROM accounting_orders o WHERE o.store_id = stores.id)
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
  let totalAmzFee = 0;
  let totalRefund = 0;
  let totalProfit = 0;

  for (const store of storeRows) {
    try {
      const { items } = await listFbaDaily(store.id, {
        startDate: latestDate,
        endDate: latestDate,
        limit: 1,
      });

      const item: FbaDailyItem = items.length > 0 && items[0]
        ? items[0]
        : {
            id: latestDate,
            date: latestDate,
            week: "",
            month: "",
            revenue: 0,
            quantity: 0,
            orders: 0,
            ads_fee: 0,
            basecost: 0,
            amazon_fee: 0,
            thue: 0,
            promotion: 0,
            return_cost: 0,
            profit: 0,
            net_profit: 0,
            balance: 0,
            roi: 0,
            tacos: 0,
            acos: 0,
            margin: 0,
            margin_pre_ads: 0,
            profit_per_item: 0,
            revenue_ads: 0,
            quantity_ads: 0,
            clicks: 0,
          };

      reports.push({ storeName: store.name, item });
      totalRev += Number(item.revenue || 0);
      totalQty += Number(item.quantity || 0);
      totalAds += Number(item.ads_fee || 0);
      totalAmzFee += Number(item.amazon_fee || 0);
      totalRefund += Number(item.return_cost || 0);
      totalProfit += Number(item.profit || 0);
    } catch (err) {
      console.warn(`[Accounting Report] Không thể lấy dữ liệu store ${store.name}:`, err);
    }
  }

  if (reports.length === 0) {
    return { success: false, reportedDate: latestDate, message: `Không có dữ liệu kinh doanh cho ngày ${latestDate}.` };
  }

  const parts = latestDate.split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : latestDate;

  // KIỂM TRA CHẶT CHẼ:
  // Nếu có bất kỳ store nào trong các store kinh doanh chưa có dữ liệu (revenue = 0 và quantity = 0),
  // tuyệt đối không gửi báo cáo thiếu (trừ khi có chỉ định ép gửi force = true).
  // Đợi cho đến khi tất cả các Store đều đã hoàn tất nạp số liệu ngày đó thì mới phát hành báo cáo.
  const incompleteStores = reports.filter(
    (r) => Number(r.item.revenue || 0) === 0 && Number(r.item.quantity || 0) === 0,
  );
  if (incompleteStores.length > 0 && !options.force) {
    const missingNames = incompleteStores.map((s) => s.storeName).join(", ");
    return {
      success: false,
      reportedDate: latestDate,
      message: `Chưa gửi báo cáo ngày ${displayDate}: Còn store (${missingNames}) chưa có đủ số liệu đơn hàng. Hệ thống sẽ đợi khi tất cả Store hoàn tất nạp dữ liệu mới tự động gửi.`,
    };
  }

  // 5. Thử render bảng ra ảnh chất lượng cao và upload lên Lark
  let imageKey: string | null = null;
  try {
    const imgBuffer = await generateDailyReportImage(latestDate, reports);
    imageKey = await uploadLarkImage(imgBuffer, `fba-daily-${latestDate}.png`);
  } catch (err) {
    console.warn("[Accounting Report] Không thể tạo hoặc upload ảnh bảng báo cáo:", err);
  }

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

  // 6. Gửi thông báo Lark bot: Gửi Card 2.0 toàn màn hình chứa ảnh bảng tràn viền (kích thước lớn nhất, sắc nét nhất)
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
