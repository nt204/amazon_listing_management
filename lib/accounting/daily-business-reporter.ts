import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";

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

export async function reportDailyBusinessData(
  scope: DataScope,
  options: { force?: boolean } = {},
): Promise<{ success: boolean; reportedDate: string | null; message: string }> {
  const sql = await getDatabaseClient();

  // 1. Tìm ngày mới nhất có dữ liệu đơn hàng trong hệ thống (nhỏ hơn ngày hiện tại)
  const maxDateRows = await sql<Array<{ latest_date: string }>>`
    SELECT MAX(date)::text as latest_date
    FROM accounting_orders
    WHERE date IS NOT NULL AND date < CURRENT_DATE
      AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
  `;

  const latestDate = maxDateRows[0]?.latest_date;
  if (!latestDate) {
    return { success: false, reportedDate: null, message: "Chưa có dữ liệu ngày hợp lệ trong hệ thống." };
  }

  // 2. Kiểm tra xem ngày mới nhất này đã được báo cáo chưa (tránh spam lặp lại)
  const settingKey = `lark_accounting_last_reported_date:${scope.teamId}`;
  if (!options.force) {
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

  // 5. Soạn nội dung thông báo bot Lark dạng bảng (Table Card)
  const card = {
    schema: "2.0",
    config: {
      width_mode: "fill",
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `Báo cáo Kinh doanh Ngày ${latestDate}`,
      },
    },
    body: {
      elements: [
        {
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
        },
      ],
    },
  };

  const fallbackLines = [
    `Báo cáo Kinh doanh Ngày ${latestDate}`,
    `Store | Revenue | Quantity | Ads Fee | AMZ Fee | Refund | Profit`,
    ...reports.map((r) => {
      const it = r.item;
      return `${r.storeName} | ${formatCurrency(it.revenue)} | ${formatQuantity(it.quantity)} | ${formatCurrency(it.ads_fee)} | ${formatCurrency(it.amazon_fee)} | ${formatCurrency(it.return_cost)} | ${formatCurrency(it.profit)}`;
    }),
    `TỔNG CỘNG | ${formatCurrency(totalRev)} | ${formatQuantity(totalQty)} | ${formatCurrency(totalAds)} | ${formatCurrency(totalAmzFee)} | ${formatCurrency(totalRefund)} | ${formatCurrency(totalProfit)}`,
  ];

  // 6. Gửi thông báo Lark bot cho danh mục "accounting"
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

  return {
    success: true,
    reportedDate: latestDate,
    message: `Đã gửi báo cáo kinh doanh ngày ${latestDate} cho ${reports.length} Store qua Lark bot.`,
  };
}
