// Phủ định từ tab Target: target nào phủ định được trong chính campaign của nó.
// Target camp Auto (close-match…), category, brand không có dạng phủ định tương ứng; SD không có Negative Keyword.

export type TargetNegativeKind = "keyword" | "asin";

export function targetNegativeKind(keyword: string, adType?: string | null): TargetNegativeKind | null {
  if ((adType || "").toUpperCase() === "SD") return null;
  const k = (keyword || "").trim().toLowerCase();
  if (!k) return null;
  if (/^(close-match|loose-match|substitutes|complements)$/.test(k)) return null;
  if (k.includes("category=") || k.includes("brand=")) return null;
  if (k.includes("asin=") || /^b0[a-z0-9]{8}$/.test(k)) return "asin";
  return "keyword";
}
