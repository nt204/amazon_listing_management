import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function formatPercent(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "0.0%";
  return `${(val * 100).toFixed(1)}%`;
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
        totalProfit += Number(item.profit || 0);
      }
    } catch (err) {
      console.warn(`[Accounting Report] Không thể lấy dữ liệu store ${store.name}:`, err);
    }
  }

  if (reports.length === 0) {
    return { success: false, reportedDate: latestDate, message: `Không có dữ liệu kinh doanh cho ngày ${latestDate}.` };
  }

  const overallAcos = totalRev > 0 ? totalAds / totalRev : 0;
  const overallMargin = totalRev > 0 ? totalProfit / totalRev : 0;

  // 5. Soạn nội dung thông báo bot Lark
  const lines: string[] = [
    `📊 **Báo cáo Dữ liệu Kinh doanh Ngày ${latestDate}**`,
    `Hệ thống vừa cập nhật dữ liệu kinh doanh mới nhất của các Store:`,
    "",
  ];

  for (const r of reports) {
    const it = r.item;
    lines.push(`🏪 **Store: ${r.storeName}**`);
    lines.push(`• Doanh thu: ${formatCurrency(it.revenue)} | Số lượng: ${it.quantity} units`);
    lines.push(`• Chi phí Ads: ${formatCurrency(it.ads_fee)} (ACOS: ${formatPercent(it.acos)} | TACOS: ${formatPercent(it.tacos)})`);
    lines.push(`• Lợi nhuận: ${formatCurrency(it.profit)} (Margin: ${formatPercent(it.margin)} | ROI: ${formatPercent(it.roi)})`);
    lines.push("");
  }

  lines.push("📈 **TỔNG HỢP TOÀN BỘ STORE:**");
  lines.push(`• Tổng doanh thu: ${formatCurrency(totalRev)} | Tổng units: ${totalQty}`);
  lines.push(`• Tổng chi phí Ads: ${formatCurrency(totalAds)} (ACOS TB: ${formatPercent(overallAcos)})`);
  lines.push(`• Tổng lợi nhuận: ${formatCurrency(totalProfit)} (Margin TB: ${formatPercent(overallMargin)})`);

  // 6. Gửi thông báo Lark bot cho danh mục "accounting"
  await notifyLarkEventBestEffort(scope, "accounting", lines);

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
