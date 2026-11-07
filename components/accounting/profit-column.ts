// Tô nổi cột Profit trong các bảng Financials (theo ngày / tháng / Lọc SKU) cho dễ dò.
// Chỉ đổi nền; màu chữ xanh/đỏ theo lãi/lỗ vẫn do từng bảng quyết định.
// Dùng !important để thắng nền cam của header, nền xen kẽ của dòng và nền cột cố định (inline style).

export function profitColClass(colId: string, part: "head" | "total" | "body"): string {
  if (colId !== "profit") return "";
  // Tiêu đề giữ màu cam chung của header; chỉ tô nền cam nhạt cho thân cột và ô TOTAL
  if (part === "head") return "";
  if (part === "total") return "!bg-orange-100";
  return "!bg-orange-50";
}
