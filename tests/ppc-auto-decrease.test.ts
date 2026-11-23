import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDecreaseCard,
  computeAutoDecreaseBid,
  shortReason,
  type AutoDecreaseItem,
} from "../lib/ppc/auto-decrease";

const settings = { minBid: 0.1 };

test("bid mới = đúng bid đề xuất của rule (không giới hạn % giảm)", () => {
  assert.equal(computeAutoDecreaseBid(1.69, 1.45, settings), 1.45);
  assert.equal(computeAutoDecreaseBid(0.9, 0.61, settings), 0.61);
});

test("không xuống dưới bid tối thiểu; đã ở sàn thì bỏ", () => {
  assert.equal(computeAutoDecreaseBid(0.12, 0.05, settings), 0.1);
  assert.equal(computeAutoDecreaseBid(0.1, 0.05, settings), null);
});

test("không phải giảm (đề xuất >= bid hiện tại) thì bỏ", () => {
  assert.equal(computeAutoDecreaseBid(1, 1, settings), null);
  assert.equal(computeAutoDecreaseBid(1, 1.2, settings), null);
  assert.equal(computeAutoDecreaseBid(0, 0.5, settings), null);
});

test("rút gọn lý do của rule", () => {
  assert.equal(
    shortReason("[SP03] SP03_HAS_ORDER_3: ACoS 45.9% vượt ACoS hòa vốn 36% -> Giảm 5% so với CPC. (Không ép sàn; trần campaign: $3.00; trần SKU: $3.00; bid cuối: $1.45.)"),
    "ACoS 45.9% vượt ACoS hòa vốn 36% → Giảm 5% so với CPC",
  );
});

function item(overrides: Partial<AutoDecreaseItem>): AutoDecreaseItem {
  return {
    recId: "rec-1", sku: "SKU1", keyword: "kw", matchType: "Exact", campaignName: "SKU1 SP03", targetId: "t1",
    currentBid: 1, recommendedBid: 0.8, finalBid: 0.8, changePct: -20, seenDays: 3, firstSeenDate: "2026-11-20",
    spend: 10, sales: 0, clicks: 12, orders: 0, acos: null, reason: "12 clicks, không có đơn → Giảm 20%", ...overrides,
  };
}

test("thẻ Lark: có nút xác nhận / hoãn mang batchId, hộp thoại xác nhận có số liệu; thẻ đã xử lý không còn nút", () => {
  const input = {
    batchId: "b-1", storeName: "HSOSTORE", runDate: "2026-11-23", snapshotDate: "2026-11-22",
    items: [item({}), item({ recId: "rec-2", sku: "SKU2", spend: 30, keyword: "mama bear", currentBid: 2, finalBid: 1.5, changePct: -25 })],
    settings: { waitDays: 3, ...settings },
  };
  const json = JSON.stringify(buildAutoDecreaseCard(input));
  assert.match(json, /"action":"AUTO_DECREASE_CONFIRM","batchId":"b-1"/);
  assert.match(json, /"action":"AUTO_DECREASE_SNOOZE","batchId":"b-1"/);
  assert.match(json, /autoDecrease=1/);
  assert.match(json, /Giảm nhiều nhất: mama bear \$2.00 → \$1.50 \(-25%\)/);
  assert.match(json, /12 click, 0 đơn/);
  assert.match(json, /\[SKU2\]\(https:\/\/[^)]*openSku=SKU2\)/);

  const resolved = JSON.stringify(buildAutoDecreaseCard({ ...input, resolved: { template: "grey", title: "Đã hoãn", note: "x" } }));
  assert.doesNotMatch(resolved, /AUTO_DECREASE_CONFIRM/);
});
