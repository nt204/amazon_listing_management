import assert from "node:assert/strict";
import test from "node:test";

import {
  looksLikeTargetMessage,
  monthWeekBlocks,
  normalizeExtraction,
  parseAiJson,
  plansFromText,
  resolveWeekRef,
  targetProgressLine,
  teamTargetsBlock,
  weekTargetCells,
  type ActiveTeamTarget,
  type PeriodTotals,
} from "../lib/accounting/team-targets";

const TEAMS = ["FBA 1", "FBA 2", "FBA 3", "FBM"];
const STORE_TEAMS = new Map([
  ["LIMIMA", ["FBA 2"]],
  ["FASTPEACE", ["FBA 2", "FBM"]],
  ["MALFIRST", ["FBA 3"]],
  ["EKASPEEK", ["FBA 3", "FBM"]],
]);
const range = (r: ReturnType<typeof resolveWeekRef>) => ("error" in r ? r.error : `${r.startDate}..${r.endDate}`);

test("tuần đúng 7 ngày T2 → CN, tuần vắt 2 tháng thuộc tháng chứa Thứ 5", () => {
  assert.deepEqual(
    monthWeekBlocks("2026-11").map((b) => `${b.startDate}..${b.endDate}`),
    ["2026-11-02..2026-11-08", "2026-11-09..2026-11-15", "2026-11-16..2026-11-22", "2026-11-23..2026-11-29"],
  );
  assert.deepEqual(
    monthWeekBlocks("2026-12").map((b) => `${b.startDate}..${b.endDate}`),
    ["2026-11-30..2026-12-06", "2026-12-07..2026-12-13", "2026-12-14..2026-12-20", "2026-12-21..2026-12-27", "2026-12-28..2027-01-03"],
  );
  assert.ok(monthWeekBlocks("2026-12").every((b) => b.days === 7));
});

test("tuần cuối T11 = 23–29/11", () => {
  assert.equal(range(resolveWeekRef("2026-11", "last", null, "2026-11-23")), "2026-11-23..2026-11-29");
  assert.equal(range(resolveWeekRef("2026-11", "cuối", null, "2026-11-23")), "2026-11-23..2026-11-29");
});

test("3 tuần tháng 12 (T12 có 5 tuần): lấy 3 tuần đầu, tuần cuối = tuần thứ 3", () => {
  assert.equal(range(resolveWeekRef("2026-12", "first", 3, "2026-11-23")), "2026-11-30..2026-12-06");
  assert.equal(range(resolveWeekRef("2026-12", "middle", 3, "2026-11-23")), "2026-12-07..2026-12-13");
  assert.equal(range(resolveWeekRef("2026-12", "last", 3, "2026-11-23")), "2026-12-14..2026-12-20");
  assert.equal(range(resolveWeekRef("2026-12", 2, 3, "2026-11-23")), "2026-12-07..2026-12-13");
  assert.equal(range(resolveWeekRef("2026-12", "3", 3, "2026-11-23")), "2026-12-14..2026-12-20");
  // Không nói số tuần: tuần cuối = tuần cuối thật của tháng
  assert.equal(range(resolveWeekRef("2026-12", "last", null, "2026-11-23")), "2026-12-28..2027-01-03");
  assert.match(range(resolveWeekRef("2026-12", 6, 3, "2026-11-23")), /chỉ có 5 tuần/);
});

test("W50 (ISO), tuần này, tuần sau", () => {
  assert.equal(range(resolveWeekRef("2026-12", "W50", null, "2026-11-23")), "2026-12-07..2026-12-13");
  assert.equal(range(resolveWeekRef("2026-11", "this", null, "2026-11-25")), "2026-11-23..2026-11-29");
  assert.equal(range(resolveWeekRef("2026-11", "next", null, "2026-11-25")), "2026-11-30..2026-12-06");
  const next = resolveWeekRef("2026-11", "next", null, "2026-11-25");
  assert.equal("label" in next && next.label, "Tuần 1 T12");
});

test("lọc tin: tin giao mục tiêu qua, câu hỏi bị loại", () => {
  assert.ok(looksLikeTargetMessage("Còn thực hiện: 4000units. tuần cuối tháng 11 tối thiếu 3000 unit. còn 17000 cho 3 tuần tháng 12: tuần cuối: 8000 tuần giữa: 5000 tuần đầu: 4000 tham khảo để có hướng đẩy ads"));
  assert.ok(looksLikeTargetMessage("tuần cuối tháng 11: Dự kiến units cần đẩy: 5000units, mỗi ngày ~700sale. hiện tại đang ~400sale. cap margin: limima 10% , fastpeace: 7% 3 tuần. tháng 12. Dự kiến: 30000units tuần 1: 6000 units. tuần 2: 10000 units. tuần 3: 14000 units."));
  assert.equal(looksLikeTargetMessage("tuần này FBA 3 bán được bao nhiêu units?"), false);
  assert.equal(looksLikeTargetMessage("phân tích malfirst"), false);
});

test("parseAiJson bỏ ```json", () => {
  assert.deepEqual(parseAiJson('```json\n{"team":"FBA 3","targets":[]}\n```'), { team: "FBA 3", targets: [] });
  assert.equal(parseAiJson("không có"), null);
});

test("tin 2: team từ store, tuần 1/2/3 của kế hoạch 3 tuần, mỗi ngày × 7 ngày ≈ tổng tuần", () => {
  const out = normalizeExtraction(
    {
      team: null,
      targets: [
        { kind: "week_total", metric: "units", value: 5000, month: "2026-11", week_ref: "last", is_estimate: true, quote: "units cần đẩy: 5000units" },
        { kind: "daily_rate", metric: "units", value: 700, month: "2026-11", week_ref: "last", quote: "mỗi ngày ~700sale" },
        { kind: "margin_floor", metric: "margin", value: 10, store: "limima", quote: "limima 10%" },
        { kind: "margin_floor", metric: "margin", value: 7, store: "FASTPEACE", quote: "fastpeace: 7%" },
        { kind: "month_total", metric: "units", value: 30000, month: "2026-12", weeks_in_plan: 3, is_estimate: true },
        { kind: "week_total", metric: "units", value: 6000, month: "2026-12", week_ref: 1, weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 10000, month: "2026-12", week_ref: "2", weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 14000, month: "2026-12", week_ref: 3, weeks_in_plan: 3 },
      ],
      context: ["hiện tại đang ~400sale"],
    },
    { sentDate: "2026-11-23", knownTeams: TEAMS, storeTeams: STORE_TEAMS },
  );
  assert.equal(out.team, "FBA 2");
  assert.deepEqual(out.items.map((i) => i.label), [
    "Tuần cuối T11", "Mỗi ngày (Tuần cuối T11)", "Tuần 1 T12", "Tuần 2 T12", "Tuần 3 T12", "Tổng T12",
    "Margin tối thiểu LIMIMA", "Margin tối thiểu FASTPEACE",
  ]);
  const weeks = out.items.filter((i) => i.kind === "week_total").map((i) => `${i.startDate}..${i.endDate}:${i.value}`);
  assert.deepEqual(weeks, [
    "2026-11-23..2026-11-29:5000",
    "2026-11-30..2026-12-06:6000",
    "2026-12-07..2026-12-13:10000",
    "2026-12-14..2026-12-20:14000",
  ]);
  const margins = out.items.filter((i) => i.kind === "margin_floor");
  assert.deepEqual(margins.map((m) => [m.storeName, m.value, m.startDate, m.endDate]), [
    ["LIMIMA", 10, "2026-11-23", null],
    ["FASTPEACE", 7, "2026-11-23", null],
  ]);
  // 700 × 7 = 4,900 ≈ 5,000 → không cảnh báo; 6k + 10k + 14k = 30k → không cảnh báo tổng tháng; báo 2 tuần cuối T12 chưa có mục tiêu
  assert.deepEqual(out.warnings, ["T12 có 5 tuần (T2–CN), tin nói 3 tuần → lấy 3 tuần đầu; tuần 21–27/12, 28/12–3/1 chưa có mục tiêu tuần."]);
});

test("tin 1: không nhắc store → team theo nhóm chat; 'còn thực hiện' = từ ngày nhắn tới hết tháng", () => {
  const out = normalizeExtraction(
    {
      targets: [
        { kind: "month_total", metric: "units", value: 4000, month: "2026-11", remaining: true, quote: "Còn thực hiện: 4000units" },
        { kind: "week_total", metric: "units", value: 3000, month: "2026-11", week_ref: "last", comparator: ">=" },
        { kind: "month_total", metric: "units", value: 17000, month: "2026-12", weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 8000, month: "2026-12", week_ref: "last", weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 5000, month: "2026-12", week_ref: "middle", weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 4000, month: "2026-12", week_ref: "first", weeks_in_plan: 3 },
      ],
    },
    { sentDate: "2026-11-23", knownTeams: TEAMS, storeTeams: STORE_TEAMS, chatTeam: "FBA 3" },
  );
  assert.equal(out.team, "FBA 3");
  const remaining = out.items.find((i) => i.label.startsWith("Còn lại"))!;
  assert.deepEqual([remaining.startDate, remaining.endDate], ["2026-11-23", "2026-11-30"]);
  // Thứ tự trên card: tuần của tháng rồi tới tổng tháng
  assert.deepEqual(out.items.map((i) => i.label), [
    "Tuần cuối T11", "Còn lại T11", "Tuần đầu T12", "Tuần giữa T12", "Tuần cuối T12", "Tổng T12",
  ]);
  assert.equal(out.warnings.length, 1);
});

test("'team 3' trong tin thắng nhóm chat; store khác team bị cảnh báo; tổng tuần lệch tổng tháng", () => {
  const out = normalizeExtraction(
    {
      targets: [
        { kind: "margin_floor", value: 10, store: "LIMIMA" },
        { kind: "month_total", metric: "units", value: 20000, month: "2026-12" },
        { kind: "week_total", metric: "units", value: 4000, month: "2026-12", week_ref: 1, weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 5000, month: "2026-12", week_ref: 2, weeks_in_plan: 3 },
        { kind: "week_total", metric: "units", value: 8000, month: "2026-12", week_ref: 3, weeks_in_plan: 3 },
      ],
    },
    { sentDate: "2026-11-23", knownTeams: TEAMS, storeTeams: STORE_TEAMS, chatTeam: "FBA 1", text: "team 3 nhé" },
  );
  assert.equal(out.team, "FBA 3");
  assert.ok(out.warnings.some((w) => w.includes("LIMIMA không thuộc FBA 3")));
  assert.ok(out.warnings.some((w) => w.includes("17,000 ≠ tổng tháng 20,000")));
});

test("tiến độ tuần: % đạt, chậm tiến độ, cần bao nhiêu/ngày; ngày cuối báo ĐẠT / KHÔNG ĐẠT", () => {
  // 400 units/ngày từ 22/11
  const totals = (from: string, to: string): PeriodTotals => {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    return { quantity: 400 * days, revenue: 10_000 * days, profit: 1_000 * days };
  };
  const week: ActiveTeamTarget = {
    kind: "week_total", metric: "units", value: 5000, startDate: "2026-11-22", endDate: "2026-11-30",
    storeName: null, comparator: ">=", isEstimate: false, label: "Tuần cuối T11",
  };
  const line = targetProgressLine(week, "2026-11-25", totals);
  assert.match(line, /1,600 \/ ≥5,000 units/);
  assert.match(line, /32%/);
  assert.match(line, /ngày 4\/9/);
  assert.match(line, /cần ~680 units\/ngày trong 5 ngày còn lại/);
  assert.match(line, /chậm/);
  assert.match(targetProgressLine(week, "2026-11-30", totals), /KHÔNG ĐẠT \(thiếu 1,400 units\)/);

  const margin: ActiveTeamTarget = { ...week, kind: "margin_floor", metric: "margin", value: 7, endDate: null, storeName: "FASTPEACE", label: "" };
  assert.match(targetProgressLine(margin, "2026-11-25", totals), /hôm nay <font color='green'>10\.0% ✅/);

  // Mục tiêu tháng 12 chưa bắt đầu thì không hiện
  const dec: ActiveTeamTarget = { ...week, startDate: "2026-12-01", endDate: "2026-12-05", label: "Tuần 1 T12" };
  const block = teamTargetsBlock([dec, week], "2026-11-25", totals);
  assert.ok(block.includes("Tuần cuối T11"));
  assert.ok(!block.includes("Tuần 1 T12"));
  assert.equal(teamTargetsBlock([dec], "2026-11-25", totals), "");
});

test("AI quên weeks_in_plan: code đọc '3 tuần. tháng 12' trong tin → tuần 3 = 14–20/12", () => {
  const text = "tuần cuối tháng 11: Dự kiến units cần đẩy: 5000units, mỗi ngày ~700sale. 3 tuần. tháng 12. Dự kiến: 30000units tuần 1: 6000 units. tuần 2: 10000 units. tuần 3: 14000 units.";
  assert.deepEqual([...plansFromText(text, "2026-11-23")], [["2026-12", 3]]);
  assert.deepEqual([...plansFromText("còn 17000 cho 3 tuần tháng 12:", "2026-11-23")], [["2026-12", 3]]);
  assert.deepEqual([...plansFromText("tháng 1 chia 4 tuần", "2026-11-23")], [["2027-01", 4]]);
  const out = normalizeExtraction(
    {
      targets: [
        { kind: "month_total", metric: "units", value: 30000, month: "2026-12" },
        { kind: "week_total", metric: "units", value: 6000, month: "2026-12", week_ref: 1 },
        { kind: "week_total", metric: "units", value: 10000, month: "2026-12", week_ref: 2 },
        { kind: "week_total", metric: "units", value: 14000, month: "2026-12", week_ref: 3 },
      ],
    },
    { sentDate: "2026-11-23", knownTeams: TEAMS, storeTeams: STORE_TEAMS, chatTeam: "FBA 2", text },
  );
  assert.deepEqual(out.items.filter((i) => i.kind === "week_total").map((i) => `${i.startDate}..${i.endDate}`), [
    "2026-11-30..2026-12-06", "2026-12-07..2026-12-13", "2026-12-14..2026-12-20",
  ]);
  assert.equal(out.warnings.length, 1);
});

test("cột Target tuần / % đạt tuần: hàng Tổng team và hàng store có target riêng; không có target → null", () => {
  // 400 units/ngày cả team, 100 units/ngày MALFIRST
  const totals = (from: string, to: string, store: string | null): PeriodTotals => {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    return { quantity: (store ? 100 : 400) * days, revenue: 0, profit: 0 };
  };
  const base: ActiveTeamTarget = {
    kind: "week_total", metric: "units", value: 3000, startDate: "2026-11-23", endDate: "2026-11-29",
    storeName: null, comparator: ">=", isEstimate: false, label: "Tuần cuối T11",
  };
  const store: ActiveTeamTarget = { ...base, value: 500, storeName: "MALFIRST" };
  // Ngày 3/7: 1,200 / 3,000 = 40% (tiến độ 1,286 → chậm < 10% → cam)
  assert.deepEqual(weekTargetCells([base, store], "2026-11-25", totals, null), { target: "≥3,000", pct: "<font color='orange'>**40.0%**</font>" });
  // MALFIRST: 300 / 500 = 60% ≥ tiến độ 214 → xanh
  assert.deepEqual(weekTargetCells([base, store], "2026-11-25", totals, "MALFIRST"), { target: "≥500", pct: "<font color='green'>**60.0%**</font>" });
  assert.equal(weekTargetCells([base], "2026-11-25", totals, "EKASPEEK"), null);
  // Ngày cuối tuần: 2,800 / 3,000 → ❌
  assert.equal(weekTargetCells([base], "2026-11-29", totals, null)!.pct, "<font color='red'>**93.3%** ❌</font>");
  // Chưa tới tuần → null
  assert.equal(weekTargetCells([{ ...base, startDate: "2026-11-30", endDate: "2026-12-06" }], "2026-11-25", totals, null), null);
});
