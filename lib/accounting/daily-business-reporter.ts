import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import sharp from "sharp";
import { notifyLarkEventBestEffort, sendLarkCardNotification, uploadLarkImage } from "@/lib/lark-notifications";

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
  const totalMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;
  const totalTacos = totalRev > 0 ? (totalAds / totalRev) * 100 : 0;

  const parts = date.split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;

  const width = 1100;
  const rowHeight = 44;
  const tableStartY = 270;
  const tableHeight = (reports.length + 2) * rowHeight;
  const totalHeight = tableStartY + tableHeight + 65;

  const colStoreX = 55;
  const colRevX = 320;
  const colQtyX = 450;
  const colAdsX = 600;
  const colAmzX = 750;
  const colRefundX = 890;
  const colProfitX = 1045;

  const nowStr = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  let rowsSvg = "";
  reports.forEach((r, idx) => {
    const it = r.item;
    const profit = Number(it.profit || 0);
    const y = tableStartY + idx * rowHeight;
    const bgFill = idx % 2 === 0 ? "rgba(255, 255, 255, 0.025)" : "rgba(255, 255, 255, 0.055)";
    const profitColor = profit >= 0 ? "#10B981" : "#EF4444";

    rowsSvg += `
      <rect x="30" y="${y}" width="1040" height="${rowHeight}" fill="${bgFill}" rx="6"/>
      <text x="${colStoreX}" y="${y + 27}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="bold" fill="#F8FAFC">${r.storeName}</text>
      <text x="${colRevX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" fill="#E2E8F0">${formatCurrency(it.revenue)}</text>
      <text x="${colQtyX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#CBD5E1">${formatQuantity(it.quantity)}</text>
      <text x="${colAdsX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" fill="#F59E0B">${formatCurrency(it.ads_fee)}</text>
      <text x="${colAmzX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#94A3B8">${formatCurrency(it.amazon_fee)}</text>
      <text x="${colRefundX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#F87171">${formatCurrency(it.return_cost)}</text>
      <text x="${colProfitX}" y="${y + 27}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="bold" fill="${profitColor}">${formatCurrency(profit)}</text>
    `;
  });

  const totalY = tableStartY + reports.length * rowHeight + 10;
  const totalProfitColor = totalProfit >= 0 ? "#34D399" : "#F87171";

  return `
  <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0F172A"/>
        <stop offset="60%" stop-color="#1E1B4B"/>
        <stop offset="100%" stop-color="#0F172A"/>
      </linearGradient>
      <linearGradient id="cardGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1E293B"/>
        <stop offset="100%" stop-color="#0F172A"/>
      </linearGradient>
      <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#4F46E5"/>
        <stop offset="100%" stop-color="#2563EB"/>
      </linearGradient>
      <linearGradient id="totalRowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#312E81"/>
        <stop offset="100%" stop-color="#1E3A8A"/>
      </linearGradient>
    </defs>

    <rect width="${width}" height="${totalHeight}" fill="url(#bgGrad)" rx="16"/>
    <rect width="${width - 4}" height="${totalHeight - 4}" x="2" y="2" fill="none" stroke="#334155" stroke-width="2" rx="15"/>

    <g transform="translate(40, 28)">
      <rect x="0" y="0" width="130" height="26" rx="6" fill="#4F46E5" fill-opacity="0.25" stroke="#6366F1" stroke-width="1"/>
      <text x="65" y="17" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="#A5B4FC">NCE HUB • FBA</text>

      <text x="0" y="62" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">BÁO CÁO KINH DOANH FBA</text>
      
      <rect x="430" y="38" width="180" height="32" rx="16" fill="#0369A1" fill-opacity="0.3" stroke="#38BDF8" stroke-width="1.2"/>
      <text x="520" y="59" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="#38BDF8">NGÀY ${displayDate}</text>
    </g>

    <!-- KPI Summary Mini Cards -->
    <g transform="translate(40, 115)">
      <rect width="235" height="74" rx="10" fill="url(#cardGrad1)" stroke="#334155" stroke-width="1"/>
      <text x="18" y="27" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#94A3B8" letter-spacing="0.5">TỔNG DOANH THU</text>
      <text x="18" y="58" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#38BDF8">${formatCurrency(totalRev)}</text>
    </g>

    <g transform="translate(295, 115)">
      <rect width="235" height="74" rx="10" fill="url(#cardGrad1)" stroke="#334155" stroke-width="1"/>
      <text x="18" y="27" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#94A3B8" letter-spacing="0.5">TỔNG SỐ LƯỢNG (QTY)</text>
      <text x="18" y="58" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#F8FAFC">${formatQuantity(totalQty)} <tspan font-size="14" font-weight="normal" fill="#94A3B8">units</tspan></text>
    </g>

    <g transform="translate(550, 115)">
      <rect width="245" height="74" rx="10" fill="url(#cardGrad1)" stroke="#334155" stroke-width="1"/>
      <text x="18" y="27" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#94A3B8" letter-spacing="0.5">CHI PHÍ ADS (TACOS)</text>
      <text x="18" y="58" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#FBBF24">${formatCurrency(totalAds)} <tspan font-size="14" font-weight="bold" fill="#F59E0B">(${totalTacos.toFixed(1)}%)</tspan></text>
    </g>

    <g transform="translate(815, 115)">
      <rect width="255" height="74" rx="10" fill="url(#cardGrad1)" stroke="#059669" stroke-width="1.5"/>
      <text x="18" y="27" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#34D399" letter-spacing="0.5">LỢI NHUẬN RÒNG (MARGIN)</text>
      <text x="18" y="58" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="#10B981">${formatCurrency(totalProfit)} <tspan font-size="14" font-weight="bold" fill="#34D399">(${totalMargin.toFixed(1)}%)</tspan></text>
    </g>

    <!-- Table Header Bar -->
    <rect x="30" y="215" width="1040" height="42" rx="8" fill="url(#headerGrad)"/>
    <text x="${colStoreX}" y="242" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">STORE</text>
    <text x="${colRevX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">DOANH THU</text>
    <text x="${colQtyX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">SỐ LƯỢNG</text>
    <text x="${colAdsX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">TIỀN ADS</text>
    <text x="${colAmzX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">PHÍ AMZ</text>
    <text x="${colRefundX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">HOÀN TIỀN</text>
    <text x="${colProfitX}" y="242" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" fill="#FFFFFF" letter-spacing="0.5">LỢI NHUẬN</text>

    <!-- Table Rows -->
    ${rowsSvg}

    <!-- Table Total Row -->
    <g transform="translate(0, 0)">
      <rect x="30" y="${totalY}" width="1040" height="50" rx="8" fill="url(#totalRowGrad)" stroke="#6366F1" stroke-width="1.8"/>
      <text x="${colStoreX}" y="${totalY + 32}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF">TỔNG CỘNG</text>
      <text x="${colRevX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#38BDF8">${formatCurrency(totalRev)}</text>
      <text x="${colQtyX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#FFFFFF">${formatQuantity(totalQty)}</text>
      <text x="${colAdsX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#FBBF24">${formatCurrency(totalAds)}</text>
      <text x="${colAmzX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#CBD5E1">${formatCurrency(totalAmz)}</text>
      <text x="${colRefundX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="900" fill="#FCA5A5">${formatCurrency(totalRefund)}</text>
      <text x="${colProfitX}" y="${totalY + 32}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="900" fill="${totalProfitColor}">${formatCurrency(totalProfit)}</text>
    </g>

    <!-- Footer -->
    <g transform="translate(40, ${totalHeight - 18})">
      <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748B">Xuất tự động lúc ${nowStr} • Hệ thống Quản lý Kinh doanh NCE HUB</text>
      <text x="${width - 80}" y="0" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#64748B">AMAZON FBA DASHBOARD</text>
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

  // 6. Gửi thông báo Lark bot
  if (options.recipient) {
    await sendLarkCardNotification(card, options.recipient);
  } else {
    await notifyLarkEventBestEffort(scope, "accounting", {
      card,
      fallbackText: fallbackLines.join("\n"),
    });

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
