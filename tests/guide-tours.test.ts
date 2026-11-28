import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PPC_AUTOBID_TOURS } from "../lib/guide/ppc-autobid-tours";
import { extractTourIds, hasTourDecision, stripTourMarkers } from "../lib/guide/types";

/** Mọi khóa data-tour đang có trong components/ (dạng "key" hoặc {cond ? "key" : undefined}). */
function declaredTourKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) {
        const src = readFileSync(path, "utf8");
        for (const m of src.matchAll(/data-tour=(?:"([^"]+)"|\{([^}]*)\})/g)) {
          if (m[1]) keys.add(m[1]);
          else for (const s of m[2].matchAll(/"([a-z0-9-]+)"/g)) keys.add(s[1]);
        }
        // Tiêu đề cột sắp xếp nhận khóa qua tham số cuối: renderSortHeader("ACoS", "acos", "right", undefined, "rec-col-acos")
        for (const m of src.matchAll(/renderSortHeader\(.*"(rec-[a-z0-9-]+)"\)/g)) keys.add(m[1]);
      }
    }
  };
  walk(join(__dirname, "..", "components"));
  return keys;
}

test("mọi phần tử kịch bản hướng dẫn trỏ tới đều có data-tour trong giao diện", () => {
  const keys = declaredTourKeys();
  const missing: string[] = [];
  for (const tour of PPC_AUTOBID_TOURS) {
    const targets = [
      ...tour.steps.flatMap((s) => [
        ...(Array.isArray(s.target) ? s.target : [s.target]),
        ...(s.before ?? []).map((a) => (a.type === "click" ? a.target : undefined)),
      ]),
      ...(tour.cleanup ?? []).map((a) => (a.type === "click" ? a.target : undefined)),
    ].filter((t): t is string => Boolean(t));
    for (const t of targets) if (!keys.has(t)) missing.push(`${tour.id} → ${t}`);
  }
  assert.deepEqual(missing, []);
});

test("id kịch bản duy nhất, dạng a-z0-9-, không trùng 'none'", () => {
  const ids = PPC_AUTOBID_TOURS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.notEqual(id, "none");
  }
});

test("đọc / bỏ mã [[tour:…]] trong câu trả lời", () => {
  const answer = "Bấm **Chi tiết**.\n\n[[tour:duyet-1-sku]]\n[[tour:none]]";
  assert.deepEqual(extractTourIds(answer), ["duyet-1-sku"]);
  assert.equal(hasTourDecision("Không có mã"), false);
  assert.equal(hasTourDecision("ok\n[[tour:none]]"), true);
  assert.equal(stripTourMarkers(answer), "Bấm **Chi tiết**.");
});
