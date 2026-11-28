// Kiểm tra kịch bản hướng dẫn: lỗi cứng + cảnh báo câu chữ (skill .claude/skills/ppc-guided-tour).
//   npx tsx scripts/lint-guide-tours.ts                 # mọi bộ
//   npx tsx scripts/lint-guide-tours.ts ppc-negative    # chỉ 1 page (hoặc id tour)
// Thoát mã 1 nếu có lỗi cứng. Tour mới / vừa sửa phải sạch cả cảnh báo.
import { join } from "node:path";

import { GUIDE_TOUR_SETS } from "@/lib/guide/all-tours";
import { declaredTourKeys, lintTours } from "@/lib/guide/tour-lint";

const filter = process.argv[2];
const sets = GUIDE_TOUR_SETS.map((s) => ({
  ...s,
  tours: filter && filter !== s.page ? s.tours.filter((t) => t.id === filter) : s.tours,
})).filter((s) => s.tours.length);

if (!sets.length) {
  console.error(`Không có page / tour nào khớp "${filter}". Page: ${GUIDE_TOUR_SETS.map((s) => s.page).join(", ")}`);
  process.exit(1);
}

const { errors, warnings } = lintTours(sets, declaredTourKeys(join(process.cwd(), "components")));
for (const e of errors) console.log(`LỖI     ${e}`);
for (const w of warnings) console.log(`CẢNH BÁO ${w}`);
const total = sets.reduce((n, s) => n + s.tours.length, 0);
console.log(`\n${total} tour · ${errors.length} lỗi · ${warnings.length} cảnh báo`);
process.exit(errors.length ? 1 : 0);
