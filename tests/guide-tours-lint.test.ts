import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { GUIDE_TOUR_SETS, isDangerKey } from "../lib/guide/all-tours";
import { declaredTourKeys, lintTours } from "../lib/guide/tour-lint";

// Vi phạm cứng của MỌI bộ kịch bản (lib/guide/all-tours.ts). Quy tắc câu chữ chỉ là cảnh báo:
// xem bằng `npx tsx scripts/lint-guide-tours.ts`.

test("mọi bộ kịch bản: id, page, whenToUse, data-tour tồn tại, không bấm nút nguy hiểm", () => {
  const { errors } = lintTours(GUIDE_TOUR_SETS, declaredTourKeys(join(__dirname, "..", "components")));
  assert.deepEqual(errors, []);
});

test("nhận diện nút nguy hiểm theo khóa data-tour", () => {
  for (const k of ["neg-nl-modal-confirm", "sale-modal-confirm", "sale-btn-export", "nc-modal-confirm", "neg-hub-delete-btn", "aq-au-start", "ad-enable", "sku-approve-selected", "neg-nl-confirm-uploaded-btn", "nc-btn-create-file"])
    assert.equal(isDangerKey(k), true, k);
  for (const k of ["aq-export-btn", "neg-nl-auto-upload-btn", "neg-nl-modal-cancel", "aq-export-cancel", "nc-modal-cancel", "sale-subtab-registry", "rec-auto-decrease-btn", "ad-close"])
    assert.equal(isDangerKey(k), false, k);
});
