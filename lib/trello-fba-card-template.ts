// Mẫu mô tả thẻ Trello FBA → BẢNG MÃ (dùng chung cho parser phía server và form hiển thị/copy).
// Parser CHỈ đọc đúng các dòng "Nhãn: giá trị" dưới đây; dòng khác trong mô tả bị bỏ qua.

export const TRELLO_CARD_FIELDS = [
  { key: "picMkt", label: "PIC MKT", hint: "" },
  { key: "picIdea", label: "PIC Idea", hint: "" },
  { key: "designPic", label: "Design", hint: "" },
  { key: "status", label: "Status", hint: "(Test / Phát triển / Hủy)" },
  { key: "event", label: "Event", hint: "" },
  { key: "size", label: "Size", hint: "" },
  { key: "fileDesign", label: "File Design", hint: "(link file design)" },
] as const;

export type TrelloCardFieldKey = (typeof TRELLO_CARD_FIELDS)[number]["key"];

export const TRELLO_STATUS_VALUES = ["Test", "Phát triển", "Hủy"] as const;

/** Nội dung dán vào mô tả thẻ */
export const TRELLO_CARD_TEMPLATE = TRELLO_CARD_FIELDS.map((f) => `${f.label}: ${f.hint}`.trimEnd()).join("\n");
