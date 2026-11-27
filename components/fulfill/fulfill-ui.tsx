import type { ReactNode } from "react";
import type { FulfillPoStatus } from "@/lib/fulfill/types";

// Giao diện fulfill theo Minimalism & Swiss (skill ui-ux-pro-max): nền slate nhạt, kẻ mảnh,
// một màu nhấn xanh (--ff-accent), màu trạng thái và màu store mang nghĩa.
// Token nằm trong .fulfill-root (app/globals.css).

export const PO_STATUS_ORDER: FulfillPoStatus[] = ["draft", "pending_sup", "producing", "shipped", "received"];

export const PO_STATUS: Record<FulfillPoStatus, { label: string; dot: string }> = {
  draft: { label: "Nháp", dot: "bg-slate-300" },
  pending_sup: { label: "Chờ xưởng nhận", dot: "bg-slate-500" },
  producing: { label: "Đang sản xuất", dot: "bg-(--ff-accent)" },
  shipped: { label: "Đã ship", dot: "bg-amber-500" },
  received: { label: "Đã nhận kho FBA", dot: "bg-(--ff-pos)" },
  cancelled: { label: "Đã hủy", dot: "bg-(--ff-neg)" },
};

export function StatusLabel({ status }: { status: FulfillPoStatus }) {
  const config = PO_STATUS[status] || PO_STATUS.draft;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-(--ff-text-2)">
      <span className={`h-2 w-2 shrink-0 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

/** Mã PO / SKU hiển thị như tem dán thùng carton: mono, khung mảnh. Dùng thống nhất ở mọi màn hình. */
export function CodeTag({ children, size = "sm" }: { children: ReactNode; size?: "sm" | "lg" }) {
  const sizing = size === "lg" ? "px-2 py-1 text-xl leading-7" : "px-1.5 py-0.5 text-xs";
  return (
    <span
      className={`inline-block rounded-sm border border-(--ff-line-strong) bg-(--ff-card) font-mono font-medium text-(--ff-text) ${sizing}`}
    >
      {children}
    </span>
  );
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US");

export const fmtMoney = (value: number | null | undefined) => money.format(Number(value) || 0);
export const fmtInt = (value: number | null | undefined) => integer.format(Number(value) || 0);

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ff-accent)";
const control = "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

export const ui = {
  btnPrimary: `inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-(--ff-accent) px-4 text-sm font-semibold text-white shadow-sm enabled:hover:bg-(--ff-accent-hover) disabled:opacity-50 motion-safe:active:scale-[0.98] ${control} ${focus}`,
  btnSecondary: `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-4 text-sm font-medium text-(--ff-text) shadow-sm hover:bg-(--ff-raised) ${control} ${focus}`,
  btnGhost: `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-text) ${control} ${focus}`,
  iconBtn: `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-(--ff-muted) hover:bg-(--ff-raised) hover:text-(--ff-text) ${control} ${focus}`,
  iconBtnDanger: `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-(--ff-muted) hover:bg-red-50 hover:text-(--ff-neg) ${control} ${focus}`,
  input: `h-9 w-full rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-3 text-sm text-(--ff-text) placeholder:text-(--ff-muted) focus:border-(--ff-accent) focus:ring-2 focus:ring-(--ff-accent)/15 focus:outline-none ${control}`,
  select: `h-9 max-w-full cursor-pointer rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-3 text-sm text-(--ff-text) focus:border-(--ff-accent) focus:ring-2 focus:ring-(--ff-accent)/15 focus:outline-none ${control}`,
  label: "mb-1.5 block text-xs font-medium text-(--ff-text-2)",
  card: "rounded-xl border border-(--ff-line) bg-(--ff-card) shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
  title: "text-2xl font-semibold tracking-tight sm:text-3xl",
  th: "px-3 py-3 text-xs font-semibold text-(--ff-head-text)",
  link: `cursor-pointer rounded-sm text-sm font-medium text-(--ff-accent) hover:text-(--ff-accent-hover) hover:underline underline-offset-4 ${focus}`,
};

export function Notice({ tone, children, onClose }: { tone: "error" | "success"; children: ReactNode; onClose?: () => void }) {
  const toneClass = tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
      <span className="flex-1">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="cursor-pointer text-xs underline underline-offset-4">
          Đóng
        </button>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-2xl border border-(--ff-line) bg-(--ff-card) shadow-[0_16px_48px_rgba(15,23,42,0.16)] ${width}`}
      >
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-(--ff-line) bg-white px-4 sm:px-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className={ui.btnGhost}>
            Đóng
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-(--ff-line-strong) bg-(--ff-raised) px-1 text-[11px] leading-none text-(--ff-muted)">
      {children}
    </kbd>
  );
}

/** Mỗi store một màu cố định (đủ tương phản trên nền trắng), dùng cho chấm ở sidebar, bảng thống kê và danh sách đợt. */
export const STORE_PALETTE = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#ea580c", "#475569"];

export function storeColorMap(stores: Array<{ id: string; name: string }>): Record<string, string> {
  const sorted = [...stores].sort((a, b) => a.name.localeCompare(b.name));
  return Object.fromEntries(sorted.map((s, i) => [s.id, STORE_PALETTE[i % STORE_PALETTE.length]]));
}

export function StoreDot({ color, className = "h-2 w-2" }: { color?: string; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ backgroundColor: color || "#94a3b8" }} />;
}
