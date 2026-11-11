import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTargetHistories, type HistoryActionInput, type HistoryWindowInput } from "../lib/ppc/auto-bid-history";

const NOW = new Date("2026-11-11T08:00:00Z");

function win(outcome: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null, observed: Record<string, unknown>, reward: number | null): HistoryWindowInput {
  return {
    status: outcome ? "MATURE" : "OBSERVING",
    outcome_label: outcome,
    baseline: { spend: 30, sales: 100, orders: 3, days: 30 },
    observed,
    comparison: { reward_usd: reward },
    evidence_quality: {},
  };
}

function action(id: string, applied: string, oldBid: number, newBid: number, windows: Partial<Record<"d3" | "d7" | "d14" | "d30", HistoryWindowInput>> = {}, target = "t1"): HistoryActionInput {
  return {
    action_id: id,
    campaign_id: "c1",
    campaign_name: "Camp",
    target_id: target,
    target_keyword: "gifts for wife",
    match_type: "EXACT",
    sku: "SKU1",
    old_value: oldBid,
    system_suggested_value: newBid,
    final_value: newBid,
    applied_delta_pct: 0,
    applied_on: applied,
    action_timestamp: `${applied}T03:00:00Z`,
    baseline: {},
    d3: windows.d3 ?? null,
    d7: windows.d7 ?? null,
    d14: windows.d14 ?? null,
    d30: windows.d30 ?? null,
  };
}

test("vừa chỉnh hôm nay: đang chờ, không coi thiếu số liệu là $0", () => {
  const [h] = buildTargetHistories([action("a1", "2026-11-11", 1, 1.05)], NOW);
  assert.equal(h.action.kind, "WAIT");
  assert.equal(h.latest.summary.state, "WAITING");
  assert.equal(h.latest.summary.metrics, null);
  assert.match(h.action.title, /3 ngày \(14\/11\)/);
});

test("đủ ngày mà chưa có báo cáo: báo thiếu báo cáo", () => {
  const [h] = buildTargetHistories([action("a1", "2026-10-01", 1, 1.05)], NOW);
  assert.equal(h.action.kind, "MISSING_DATA");
  assert.equal(h.latest.windows[30].state, "OVERDUE");
});

test("loss 7 ngày sau chuỗi tăng: quay về bid tốt nhất trong lịch sử", () => {
  const items = [
    action("a1", "2026-10-01", 0.8, 0.85, { d7: win("POSITIVE", { spend: 8, sales: 40, orders: 1 }, 6) }),
    action("a2", "2026-10-10", 0.85, 0.9, { d7: win("POSITIVE", { spend: 9, sales: 60, orders: 2 }, 12) }),
    action("a3", "2026-10-25", 0.9, 1.0, { d7: win("NEGATIVE", { spend: 20, sales: 20, orders: 1 }, -9) }),
  ];
  const [h] = buildTargetHistories(items, NOW);
  assert.equal(h.steps.length, 3);
  assert.equal(h.bestStep?.action.action_id, "a2");
  assert.equal(h.action.kind, "REVERT");
  assert.equal(h.action.targetBid, 0.9);
  assert.match(h.action.title, /\$0\.90/);
});

test("loss chỉ ở mốc 3 ngày: theo dõi sát, chưa hoàn bid", () => {
  const [h] = buildTargetHistories([action("a1", "2026-11-06", 1, 1.1, { d3: win("NEGATIVE", { spend: 6, sales: 0, orders: 0 }, -4) })], NOW);
  assert.equal(h.action.kind, "WATCH");
  assert.equal(h.action.targetBid, 1.1);
});

test("win: giữ bid, gom theo target và tính từ lần chỉnh gần nhất", () => {
  const items = [
    action("b1", "2026-10-20", 1.2, 1.0, { d7: win("POSITIVE", { spend: 5, sales: 30, orders: 1 }, 3) }, "t2"),
    action("a1", "2026-11-10", 1, 1.05, {}, "t1"),
  ];
  const histories = buildTargetHistories(items, NOW);
  const t2 = histories.find((h) => h.key === "t2")!;
  assert.equal(t2.action.kind, "SCALE");
  assert.match(t2.action.title, /Giữ bid đã giảm \$1\.00/);
  assert.equal(histories.find((h) => h.key === "t1")!.action.kind, "WAIT");
});

test("gộp action ghi trùng cùng ngày cùng bid thành một lần chỉnh", () => {
  const [h] = buildTargetHistories([
    action("a1", "2026-11-01", 0.77, 0.81),
    action("a2", "2026-11-01", 0.77, 0.81),
    action("a3", "2026-11-05", 0.81, 0.85),
  ], NOW);
  assert.deepEqual(h.steps.map((s) => s.action.action_id), ["a2", "a3"]);
});

test("lần chỉnh gần nhất bị ngắt: giữ bid, không báo chờ kết quả", () => {
  const interrupted: HistoryWindowInput = { status: "INTERRUPTED", outcome_label: "INTERRUPTED", baseline: {}, observed: {}, comparison: {}, evidence_quality: { validity: "INTERRUPTED" } };
  const [h] = buildTargetHistories([action("a1", "2026-10-05", 0.51, 0.54, { d3: interrupted, d7: interrupted, d14: interrupted, d30: interrupted })], NOW);
  assert.equal(h.latest.summary.state, "INTERRUPTED");
  assert.equal(h.action.kind, "KEEP");
});

test("báo cáo sau ngày chỉnh vẫn chạy bid cũ: áp lại bid; báo cáo cũ hơn ngày chỉnh thì không kết luận", () => {
  const applied = { ...action("a1", "2026-10-05", 0.51, 0.54), current: { bid: 0.51, asOf: "2026-10-20" } };
  const [h] = buildTargetHistories([applied], NOW);
  assert.equal(h.action.kind, "NOT_APPLIED");
  assert.equal(h.action.targetBid, 0.54);

  const stale = { ...action("a1", "2026-10-05", 0.51, 0.54), current: { bid: 0.51, asOf: "2026-09-30" } };
  const [h2] = buildTargetHistories([stale], NOW);
  assert.notEqual(h2.action.kind, "NOT_APPLIED");
});
