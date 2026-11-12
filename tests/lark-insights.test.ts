import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHelpText,
  classifyStock,
  compareWeeks,
  detectAnomalies,
  isHelpCommand,
  mondayOf,
  monthPace,
  summarizeKpi,
  vnWeekdayHour,
  type DayLike,
  type KpiSkuLike,
} from "../lib/accounting/lark-insights-calc";
import { DEFAULT_TARGET_FORMULA, emptyMetrics, type KpiMetrics } from "../lib/accounting/kpi-calc";

test("isHelpCommand nhận /help và câu tiếng Việt, không nhận câu hỏi thường", () => {
  for (const m of ["/help", "help", "/HELP ", "trợ giúp", "hướng dẫn", "huong dan", "/menu", "bot làm được gì?"]) {
    assert.equal(isHelpCommand(m), true, m);
  }
  for (const m of ["help me check LIMIMA", "hướng dẫn phủ định từ khóa", "revenue hôm qua"]) {
    assert.equal(isHelpCommand(m), false, m);
  }
});

test("buildHelpText điền store của người hỏi vào câu mẫu", () => {
  const text = buildHelpText(["LIMIMA", "MALFIRST"]);
  assert.match(text, /LIMIMA, MALFIRST/);
  assert.match(text, /LIMIMA tháng này đạt bao nhiêu % KPI/);
  assert.doesNotMatch(text, /BOZSPACER/);
});

test("monthPace: tháng đang chạy / đã qua / chưa tới", () => {
  assert.deepEqual(monthPace("2026-11", "2026-11-10"), { elapsedDays: 10, daysInMonth: 30, pace: 10 / 30 });
  assert.equal(monthPace("2026-10", "2026-11-10").pace, 1);
  assert.equal(monthPace("2026-12", "2026-11-10").pace, 0);
});

test("mondayOf và vnWeekdayHour", () => {
  assert.equal(mondayOf("2026-11-11"), "2026-11-09"); // Thứ Tư → Thứ Hai
  assert.equal(mondayOf("2026-11-15"), "2026-11-09"); // Chủ Nhật thuộc tuần bắt đầu Thứ Hai trước đó
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  // 2026-11-09 01:30 UTC = 08:30 Thứ Hai giờ VN
  assert.deepEqual(vnWeekdayHour(new Date("2026-11-09T01:30:00Z")), { weekday: 1, hour: 8 });
});

const m = (p: Partial<KpiMetrics>): KpiMetrics => ({ ...emptyMetrics(), ...p });

test("summarizeKpi: % đạt KPI theo mục tiêu từng SKU (giống trang KPI)", () => {
  const sku = (name: string, units: number, revenue: number, profit: number): KpiSkuLike => ({
    sku: name,
    group: "dev",
    price: 20,
    basecost_unit: 5,
    amazon_fee_unit: 4,
    referral_pct: 0.15,
    actual: { prev: null, cur: m({ revenue, quantity: revenue / 20, profit }), ly: null, lyNext: null },
    target: { cur: { units, tacos: 0.1, price: 20, storage_fee: 0 }, next: null },
  });
  const { report, hasTargetCur } = summarizeKpi({
    skus: [sku("A", 100, 1500, 300), sku("B", 50, 500, -20)],
    teamTargets: { cur: {}, next: {} },
    targetFormula: DEFAULT_TARGET_FORMULA,
    storeFees: { prev: null, cur: null, ly: null, lyNext: null },
    sources: { prev: "closed", cur: "live", ly: "none", lyNext: "none" },
  });
  assert.equal(hasTargetCur, true);
  // Mục tiêu Revenue = (100 + 50) × $20 = $3,000; thực tế $2,000 → 66.7%
  assert.equal(report.revenue.tCur, 3000);
  assert.equal(report.revenue.cur, 2000);
  assert.ok(Math.abs((report.revenue.kpi ?? 0) - 2000 / 3000) < 1e-9);
  assert.equal(report.revenue.ly, null); // cùng kỳ không có nguồn → bỏ trống
});

test("summarizeKpi: không có mục tiêu SKU thì dùng mục tiêu tổng team", () => {
  const { report, hasTargetCur } = summarizeKpi({
    skus: [{
      sku: "A", group: "dev", price: 20, basecost_unit: null, amazon_fee_unit: null, referral_pct: null,
      actual: { prev: null, cur: m({ revenue: 800 }), ly: null, lyNext: null },
      target: { cur: null, next: null },
    }],
    teamTargets: { cur: { dev: m({ revenue: 1000 }) }, next: {} },
    targetFormula: DEFAULT_TARGET_FORMULA,
    storeFees: { prev: null, cur: null, ly: null, lyNext: null },
    sources: { prev: "none", cur: "live", ly: "none", lyNext: "none" },
  });
  assert.equal(hasTargetCur, true);
  assert.equal(report.revenue.kpi, 0.8);
});

test("classifyStock: hết hàng / sắp hết / cần nhập / đủ / không bán", () => {
  const th = { velocityDays: 14, lowDays: 14, reorderDays: 45 };
  const base = { sku: "X", status: "Phát triển", unsellable: 0, inTransit: 0, inboundPending: 0, nextArrival: null };
  // 28 units / 14 ngày = 2/ngày
  assert.equal(classifyStock({ ...base, sellable: 0, unitsSold: 28 }, th).level, "het_hang");
  const low = classifyStock({ ...base, sellable: 20, unitsSold: 28 }, th);
  assert.equal(low.level, "sap_het");
  assert.equal(low.daysOfCover, 10);
  assert.equal(low.suggestUnits, 70); // 2 × 45 − 20
  const reorder = classifyStock({ ...base, sellable: 40, inboundPending: 20, unitsSold: 28 }, th);
  assert.equal(reorder.level, "can_nhap"); // 20 ngày sẵn bán, 30 ngày tính cả hàng về < 45
  assert.equal(reorder.daysWithInbound, 30);
  assert.equal(classifyStock({ ...base, sellable: 40, inboundPending: 60, unitsSold: 28 }, th).level, "du_hang");
  // SKU không có trong Inventory Ledger: không được coi là hết hàng
  const unknown = classifyStock({ ...base, sellable: 0, unitsSold: 28, hasBalance: false }, th);
  assert.equal(unknown.level, "chua_co_ton");
  assert.equal(unknown.suggestUnits, 0);
  const idle = classifyStock({ ...base, sellable: 40, unitsSold: 0 }, th);
  assert.equal(idle.level, "khong_ban");
  assert.equal(idle.daysOfCover, null);
});

function series(base: Partial<DayLike>, today: Partial<DayLike>): DayLike[] {
  const day = (date: string, p: Partial<DayLike>): DayLike => ({ date, revenue: 0, adsFee: 0, revenueAds: 0, profit: 0, quantity: 0, ...p });
  const out: DayLike[] = [];
  for (let i = 1; i <= 7; i++) out.push(day(`2026-11-0${i}`, base));
  out.push(day("2026-11-08", today));
  return out;
}

test("detectAnomalies: Revenue rơi mạnh và ACOS tăng vọt", () => {
  const days = series({ revenue: 1000, adsFee: 100, revenueAds: 500 }, { revenue: 400, adsFee: 120, revenueAds: 200 });
  const kinds = detectAnomalies(days, "2026-11-08").map((a) => a.kind);
  // Revenue −60%; ACOS 20% → 60%
  assert.deepEqual(kinds, ["revenue_drop", "acos_spike"]);
});

test("detectAnomalies: biến động nhỏ hoặc thiếu ngày nền thì không báo", () => {
  assert.deepEqual(detectAnomalies(series({ revenue: 1000, adsFee: 100, revenueAds: 500 }, { revenue: 900, adsFee: 100, revenueAds: 480 }), "2026-11-08"), []);
  // Store nhỏ (< $200/ngày) không báo Revenue rơi
  assert.deepEqual(detectAnomalies(series({ revenue: 100 }, { revenue: 10 }), "2026-11-08"), []);
  const short = series({ revenue: 1000 }, { revenue: 100 }).slice(4);
  assert.deepEqual(detectAnomalies(short, "2026-11-08"), []);
});

test("detectAnomalies: Ads chi tiền nhưng 0 sales từ Ads", () => {
  const a = detectAnomalies(series({ revenue: 1000, adsFee: 100, revenueAds: 500 }, { revenue: 1000, adsFee: 80, revenueAds: 0 }), "2026-11-08");
  assert.deepEqual(a.map((x) => x.kind), ["ads_no_sales"]);
});

test("compareWeeks: so cùng số ngày tuần trước", () => {
  const days: DayLike[] = [];
  for (let d = 2; d <= 15; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    days.push({ date, revenue: d >= 9 ? 200 : 100, adsFee: 10, revenueAds: 50, profit: 20, quantity: 1 });
  }
  // Tuần 09–13 (5 ngày) so với 02–06
  const w = compareWeeks(days, "2026-11-09", "2026-11-13");
  assert.equal(w.cur.revenue, 1000);
  assert.equal(w.prev.revenue, 500);
  assert.equal(w.prev.end, "2026-11-06");
  assert.equal(w.revenueChange, 1);
});

import { baseWindowWeights, planRestock, retailEvents, seasonalFactor, upcomingEvents } from "../lib/accounting/lark-insights-calc";

test("retailEvents: Black Friday / Cyber Monday đúng ngày", () => {
  const ev = Object.fromEntries(retailEvents(2026).map((e) => [e.name, e.date]));
  assert.equal(ev["Black Friday"], "2026-11-27"); // Thanksgiving 26/11/2026
  assert.equal(ev["Cyber Monday"], "2026-11-30");
  assert.equal(ev["Mother's Day"], "2026-05-10");
  assert.deepEqual(upcomingEvents("2026-11-12", "2026-12-31").map((e) => e.name), ["Black Friday", "Cyber Monday", "Giáng sinh (khách đặt trước ~15/12)"]);
});

test("baseWindowWeights: 28 ngày vắt qua 2 tháng", () => {
  const w = baseWindowWeights("2026-11-10");
  assert.ok(Math.abs(w["2026-11"] - 10 / 28) < 1e-9);
  assert.ok(Math.abs(w["2026-10"] - 18 / 28) < 1e-9);
});

test("seasonalFactor: theo units/ngày; SKU đủ mẫu → SKU; thiếu → nhóm, rồi store; kẹp 0.5–3", () => {
  const nov = { "2026-11": 1 }; // 28 ngày gần nhất nằm trọn tháng 11
  // Tháng 11 năm trước 30 ngày, tháng 12 có 31 ngày: 62/31 = 2/ngày so với 30/30 = 1/ngày → x2
  assert.deepEqual(seasonalFactor({ sku: { "2025-11": 30, "2025-12": 62 }, productType: null, store: {} }, nov, "2026-12"), { factor: 2, clamped: false, level: "sku" });
  // SKU mới → nhóm sản phẩm
  assert.equal(seasonalFactor({ sku: {}, productType: { "2025-11": 300, "2025-12": 775 }, store: {} }, nov, "2026-12").level, "product_type");
  // Không có nhóm → cả store
  const st = seasonalFactor({ sku: {}, productType: null, store: { "2025-11": 3000, "2025-12": 4650 } }, nov, "2026-12");
  assert.equal(st.level, "store");
  assert.ok(Math.abs(st.factor - 1.5) < 1e-9);
  // Giới hạn tối đa x5, có đánh dấu
  const capped = seasonalFactor({ sku: { "2025-11": 30, "2025-12": 900 }, productType: null, store: {} }, nov, "2026-12");
  assert.equal(capped.factor, 5);
  assert.equal(capped.clamped, true);
  // Thiếu một tháng của cửa sổ nền → không dùng mức đó
  assert.deepEqual(seasonalFactor({ sku: { "2025-11": 30, "2025-12": 62 }, productType: null, store: {} }, { "2026-10": 0.5, "2026-11": 0.5 }, "2026-12"), { factor: 1, clamped: false, level: "none" });
  // Không có dữ liệu năm trước → 1
  assert.deepEqual(seasonalFactor({ sku: {}, productType: null, store: {} }, nov, "2026-12"), { factor: 1, clamped: false, level: "none" });
});

test("planRestock: mùa cao làm tăng gợi ý và kéo sớm hạn đặt hàng", () => {
  const daily = new Array(56).fill(4); // 4 units/ngày đều
  const base = { sku: "A", status: "Phát triển", productType: "Tumbler", daily, sellable: 200, inTransit: 0, inboundPending: 0, nextArrival: null };
  const settings = { leadTimeDays: 40, coverDays: 30, z: 1.65 };
  const flat = planRestock({ ...base, season: { sku: {}, productType: null, store: {} } }, "2026-11-10", settings);
  const peak = planRestock({ ...base, season: { sku: { "2025-10": 103, "2025-11": 100, "2025-12": 207, "2026-01": 103 }, productType: null, store: {} } }, "2026-11-10", settings);
  assert.equal(flat.baseUnitsPerDay, 4);
  assert.equal(flat.safetyStock, 0); // bán đều, không dao động
  assert.equal(flat.demandTotal, 280); // 70 ngày × 4
  assert.equal(flat.suggestUnits, 80); // 280 − 200
  assert.equal(flat.stockoutDate, "2026-12-30"); // 200 / 4 = 50 ngày
  assert.ok(peak.demandTotal > flat.demandTotal, "tháng 12 gấp đôi → nhu cầu cao hơn");
  assert.ok(peak.suggestUnits > flat.suggestUnits);
  assert.ok((peak.stockoutDate ?? "") < (flat.stockoutDate ?? ""), "mùa cao hết hàng sớm hơn");
  assert.equal(peak.orderNow, true); // phải đặt ngay mới kịp
  assert.equal(peak.confidence, "cao");
});

test("planRestock: hàng đang về và SKU ít bán", () => {
  const settings = { leadTimeDays: 40, coverDays: 30, z: 1.65 };
  const season = { sku: {}, productType: null, store: {} };
  const covered = planRestock({ sku: "B", status: null, productType: null, daily: new Array(56).fill(2), sellable: 50, inTransit: 0, inboundPending: 200, nextArrival: "2026-11-20", season }, "2026-11-10", settings);
  assert.equal(covered.suggestUnits, 0); // 140 nhu cầu < 250 tồn + đang về
  const sparse = new Array(56).fill(0);
  sparse[50] = 3;
  const thin = planRestock({ sku: "C", status: "Test", productType: null, daily: sparse, sellable: 0, inTransit: 0, inboundPending: 0, nextArrival: null, season }, "2026-11-10", settings);
  assert.equal(thin.confidence, "thấp");
  assert.ok(thin.safetyStock > 0);
});
