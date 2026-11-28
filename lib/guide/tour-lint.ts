import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { GuideAction, GuideTour } from "@/lib/guide/types";
import { isDangerKey } from "@/lib/guide/all-tours";

// Kiểm tra kịch bản hướng dẫn (dùng chung cho tests/guide-tours-lint.test.ts và scripts/lint-guide-tours.ts).
// errors = vi phạm cứng (test fail). warnings = quy tắc câu chữ của skill ppc-guided-tour (tour mới / vừa sửa phải sạch).

/** Mọi khóa data-tour trong components/ (dạng "key", {cond ? "key" : undefined}, hoặc tham số cuối của renderSortHeader). */
export function declaredTourKeys(componentsDir: string): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) {
        const src = readFileSync(path, "utf8");
        // data-tour=… và prop chuyển tiếp khóa xuống component con (vd toggleTour="nc-run-sp04-toggle")
        for (const m of src.matchAll(/(?:data-tour|\b[a-z][a-zA-Z]*Tour)=(?:"([^"]+)"|\{([^}]*)\})/g)) {
          if (m[1]) keys.add(m[1]);
          else for (const s of m[2].matchAll(/"([a-z0-9-]+)"/g)) keys.add(s[1]);
        }
        for (const m of src.matchAll(/renderSortHeader\(.*"(rec-[a-z0-9-]+)"\)/g)) keys.add(m[1]);
      }
    }
  };
  walk(componentsDir);
  return keys;
}

/** Mọi khóa bị bấm: target của click + khóa hoàn tác dạng chuỗi (cũng sẽ bị bấm khi kết thúc). */
const clickTargets = (actions: GuideAction[] | undefined) =>
  (actions ?? []).flatMap((a) => (a.type === "click" ? [a.target, ...(typeof a.undo === "string" ? [a.undo] : [])] : []));

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => (s ? s.split(" ").length : 0);
/** Bỏ số thứ tự đầu tiêu đề ("3. Chọn store") trước khi đếm chữ. */
const titleWords = (t: string) => words(plain(t).replace(/^\d+[.)]\s*/, ""));
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỹ“"(<0-9])/u).filter((x) => x.trim()).length;

const EMPTY_OPENERS = /^(ở bước này|tiếp theo|như bạn thấy|bây giờ|rất đơn giản|đầu tiên,? chúng ta|chúng ta sẽ)/i;

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export function lintTours(sets: { page: string; tours: GuideTour[] }[], keys: Set<string>): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();

  for (const set of sets) {
    if (set.tours.length && !set.tours.some((t) => t.kind === "main")) errors.push(`${set.page}: chưa có tour kind "main" (chức năng chính)`);
    for (const tour of set.tours) {
      const at = `${tour.id}`;
      if (!/^[a-z0-9-]+$/.test(tour.id) || tour.id === "none") errors.push(`${at}: id phải dạng a-z0-9- và khác "none"`);
      if (seen.has(tour.id)) errors.push(`${at}: trùng id với một tour của ${seen.get(tour.id)}`);
      seen.set(tour.id, set.page);
      if (tour.page !== set.page) errors.push(`${at}: page "${tour.page}" khác page của bộ (${set.page})`);
      if (!tour.whenToUse?.trim()) errors.push(`${at}: thiếu whenToUse (AI dựa vào đây để chọn tour)`);
      if (!tour.summary?.trim()) errors.push(`${at}: thiếu summary`);
      if (tour.steps.length === 0) errors.push(`${at}: không có bước nào`);

      // Phần tử tồn tại + không bấm nút nguy hiểm
      const typeTargets = tour.steps.flatMap((s) => (s.before ?? []).flatMap((a) => (a.type === "type" ? [a.target] : [])));
      const allTargets = [
        ...typeTargets,
        ...tour.steps.flatMap((s) => [...(Array.isArray(s.target) ? s.target : s.target ? [s.target] : []), ...clickTargets(s.before)]),
        ...clickTargets(tour.cleanup),
      ];
      for (const t of new Set(allTargets)) if (!keys.has(t)) errors.push(`${at}: data-tour "${t}" không có trong components/`);
      for (const t of new Set([...tour.steps.flatMap((s) => clickTargets(s.before)), ...clickTargets(tour.cleanup)])) {
        if (isDangerKey(t)) errors.push(`${at}: bấm vào nút nguy hiểm "${t}" — chỉ được làm sáng (nếu nút chỉ mở hộp xác nhận: thêm vào SAFE_OPENER_KEYS + data-tour-safe)`);
      }

      // Quy tắc câu chữ / cấu trúc (cảnh báo)
      if (tour.steps.length > 9) warnings.push(`${at}: ${tour.steps.length} bước (>9) — tách tour`);
      if (tour.steps.length < 4) warnings.push(`${at}: ${tour.steps.length} bước (<4) — gộp vào tour khác hoặc làm tooltip`);
      // Bấm có hoàn tác (undo) rồi mà cleanup lại bấm cùng khóa → bị bấm 2 lần, đảo ngược trạng thái người dùng
      const undoKeys = new Set(tour.steps.flatMap((s) => (s.before ?? []).flatMap((a) => (a.type === "click" && a.undo === true ? [a.target] : []))));
      for (const a of tour.cleanup ?? []) if (a.type === "click" && undoKeys.has(a.target)) errors.push(`${at}: cleanup bấm lại "${a.target}" trong khi bước đã có undo — bỏ khỏi cleanup`);
      const usesBefore = tour.steps.some((s) => s.before?.some((a) => a.type === "click" && !a.undo));
      if (usesBefore && !tour.cleanup?.length) warnings.push(`${at}: có thao tác before nhưng không có cleanup trả màn hình về như cũ`);
      const last = tour.steps[tour.steps.length - 1];
      if (last && !last.target) warnings.push(`${at}: bước cuối không trỏ vào chỗ hiện kết quả`);
      if (last?.optional) warnings.push(`${at}: bước cuối (kết quả) là optional — không thấy phần tử thì tour kết thúc mà không có kết quả`);

      tour.steps.forEach((s, i) => {
        const where = `${at} #${i + 1} "${plain(s.title)}"`;
        const body = plain(s.body);
        if (titleWords(s.title) > 6) warnings.push(`${where}: tiêu đề ${titleWords(s.title)} tiếng (>6)`);
        if (words(body) > 40) warnings.push(`${where}: nội dung ${words(body)} tiếng (>40)`);
        if (sentences(body) > 2) warnings.push(`${where}: nội dung ${sentences(body)} câu (>2)`);
        if (EMPTY_OPENERS.test(body)) warnings.push(`${where}: mở đầu bằng câu dẫn rỗng`);
        if (/[A-ZÀ-Ỹ]{4,}(\s+[A-ZÀ-Ỹ]{2,}){1,}/u.test(body.replace(/\b(ACOS|ACoS|CPC|ASIN|SKU|FBA|AWD|ST|KW|SP\d*|SB\d*|SD|AI|CSV|CVR|RPC|PIC|FL|ID)\b/g, "")))
          warnings.push(`${where}: viết HOA cả cụm để nhấn mạnh — dùng <b> và câu hệ quả`);
      });
    }
  }
  return { errors, warnings };
}
