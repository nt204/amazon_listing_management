import type { MetricDefinition } from "@/lib/metrics/types";

export interface MetricRegistry<Row> {
  list(): MetricDefinition<Row>[];
  get(id: string): MetricDefinition<Row> | undefined;
  require(id: string): MetricDefinition<Row>;
  /** Tìm theo id / tên / alias, không phân biệt hoa thường và dấu. */
  find(query: string): MetricDefinition<Row> | undefined;
}

export function normalizeMetricText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/**
 * Tạo danh mục và kiểm tra tính nhất quán ngay khi nạp module: chỉ số dẫn xuất / tỷ lệ phải tham chiếu
 * chỉ số có thật, không có vòng lặp, id / alias không trùng. Sai thì lỗi ngay lúc khởi động thay vì
 * agent giải thích sai.
 */
export function createMetricRegistry<Row>(definitions: MetricDefinition<Row>[]): MetricRegistry<Row> {
  const byId = new Map<string, MetricDefinition<Row>>();
  for (const def of definitions) {
    if (byId.has(def.id)) throw new Error(`Metric trùng id: ${def.id}`);
    byId.set(def.id, def);
  }

  const refs = (def: MetricDefinition<Row>) =>
    def.kind === "derived" ? def.terms.map((t) => t.metric) : def.kind === "ratio" ? [def.numerator, def.denominator] : [];
  for (const def of definitions) {
    for (const ref of refs(def)) {
      if (!byId.has(ref)) throw new Error(`Metric ${def.id} tham chiếu metric không tồn tại: ${ref}`);
    }
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`Metric có vòng lặp phụ thuộc tại: ${id}`);
    visiting.add(id);
    refs(byId.get(id)!).forEach(visit);
    visiting.delete(id);
    done.add(id);
  };
  definitions.forEach((d) => visit(d.id));

  const byName = new Map<string, MetricDefinition<Row>>();
  for (const def of definitions) {
    for (const name of [def.id, def.label, ...def.aliases]) {
      const key = normalizeMetricText(name);
      const existing = byName.get(key);
      if (existing && existing.id !== def.id) throw new Error(`Alias "${name}" dùng cho cả ${existing.id} và ${def.id}`);
      byName.set(key, def);
    }
  }

  return {
    list: () => [...definitions],
    get: (id) => byId.get(id),
    require(id) {
      const def = byId.get(id);
      if (!def) throw new Error(`Không có chỉ số "${id}". Các chỉ số hợp lệ: ${[...byId.keys()].join(", ")}`);
      return def;
    },
    find: (query) => byId.get(query) ?? byName.get(normalizeMetricText(query)),
  };
}
