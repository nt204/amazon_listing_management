// Dạng chạy của campaign, nhận theo tên campaign (cách team đặt tên: "<SKU> SP03 KW Exact …", "<SKU> SB05 VIDEO …",
// "<SKU> SP04 Auto …", "<SKU> FL Asin …"). SD nhận thêm theo ad_type vì camp SD cũ không ghi mã trong tên.
// Dùng ở tab Target để lọc nhanh theo dạng chạy.

export const PPC_RUN_TYPES = ["SP03", "SP04", "SB01", "SB05", "SD", "FL"] as const;
export type PpcRunType = (typeof PPC_RUN_TYPES)[number];

export const PPC_RUN_TYPE_LABEL: Record<PpcRunType, string> = {
  SP03: "SP03",
  SP04: "SP04",
  SB01: "SB01",
  SB05: "SB05",
  SD: "SD",
  FL: "FL Asin",
};

/** Regex Postgres (~*) cho từng dạng chạy, áp lên campaign_name. */
const NAME_PATTERN: Record<PpcRunType, string> = {
  SP03: "SP03",
  SP04: "SP04|\\mAUTO\\M",
  SB01: "SB01",
  SB05: "SB05|\\mVIDEO\\M",
  SD: "\\mSD0?[0-9]",
  FL: "FL[ _-]?ASIN",
};

/** "SP03,SB05" → ["SP03","SB05"]; bỏ giá trị lạ, sắp theo thứ tự cố định để khoá cache ổn định. */
export function parseRunTypes(raw: string | null | undefined): PpcRunType[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(",").map((v) => v.trim().toUpperCase()));
  return PPC_RUN_TYPES.filter((t) => wanted.has(t));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlTag = any;

/** Điều kiện SQL (đã có "AND") lọc theo các dạng chạy đã chọn; rỗng nếu không chọn gì. */
export function runTypeSql(sql: SqlTag, types: PpcRunType[], cols: { campaignCol: string; adTypeCol: string }) {
  if (types.length === 0) return sql``;
  const campaign = sql.unsafe(cols.campaignCol);
  const adType = sql.unsafe(cols.adTypeCol);
  const parts = types.map((t) =>
    t === "SD"
      ? sql`(${adType} = 'SD' OR ${campaign} ~* ${NAME_PATTERN.SD})`
      : sql`${campaign} ~* ${NAME_PATTERN[t]}`,
  );
  const joined = parts.reduce((acc: SqlTag, cur: SqlTag) => sql`${acc} OR ${cur}`);
  return sql`AND (${joined})`;
}
