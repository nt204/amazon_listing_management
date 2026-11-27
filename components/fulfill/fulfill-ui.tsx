import type { ReactNode } from "react";
import type { FulfillPoStatus } from "@/lib/fulfill/types";

// Giao diện fulfill: nền graphite trung tính, một màu nhấn kraft (--ff-accent).
// Token nằm trong .fulfill-root (app/globals.css).

export const PO_STATUS_ORDER: FulfillPoStatus[] = ["draft", "pending_sup", "producing", "shipped", "received"];

export const PO_STATUS: Record<FulfillPoStatus, { label: string; dot: string; bar: string }> = {
  draft: { label: "Nháp", dot: "bg-neutral-300", bar: "bg-neutral-200" },
  pending_sup: { label: "Chờ xưởng nhận", dot: "bg-neutral-500", bar: "bg-neutral-400" },
  producing: { label: "Đang sản xuất", dot: "bg-(--ff-accent)", bar: "bg-(--ff-accent)" },
  shipped: { label: "Đã ship", dot: "bg-sky-700", bar: "bg-sky-700/70" },
  received: { label: "Đã nhận kho FBA", dot: "bg-green-600", bar: "bg-green-600/70" },
  cancelled: { label: "Đã hủy", dot: "bg-red-600", bar: "bg-red-600/50" },
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

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ff-accent)/40";
const control = "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

export const ui = {
  btnPrimary: `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--ff-accent) px-4 text-sm font-medium text-white hover:bg-(--ff-accent-hover) active:scale-[0.98] ${control} ${focus}`,
  btnSecondary: `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-4 text-sm font-medium text-(--ff-text) hover:bg-(--ff-raised) ${control} ${focus}`,
  btnGhost: `inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-(--ff-text-2) hover:bg-(--ff-raised) hover:text-(--ff-text) ${control} ${focus}`,
  iconBtn: `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-(--ff-muted) hover:bg-(--ff-raised) hover:text-(--ff-text) ${control} ${focus}`,
  iconBtnDanger: `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-(--ff-muted) hover:bg-red-50 hover:text-red-600 ${control} ${focus}`,
  input: `h-9 w-full rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-3 text-sm text-(--ff-text) placeholder:text-(--ff-muted) focus:border-(--ff-accent) focus:outline-none focus:ring-2 focus:ring-(--ff-accent)/20 ${control}`,
  select: `h-9 cursor-pointer rounded-lg border border-(--ff-line-strong) bg-(--ff-card) px-3 text-sm text-(--ff-text) focus:border-(--ff-accent) focus:outline-none focus:ring-2 focus:ring-(--ff-accent)/20 ${control}`,
  label: "mb-1.5 block text-xs font-medium text-(--ff-text-2)",
  card: "rounded-xl border border-(--ff-line) bg-(--ff-card)",
  th: "px-3 py-2 text-xs font-medium text-(--ff-muted)",
  link: "text-sm text-(--ff-text-2) underline decoration-(--ff-line-strong) underline-offset-4 hover:text-(--ff-text) hover:decoration-(--ff-text)",
};

export function Notice({ tone, children, onClose }: { tone: "error" | "success"; children: ReactNode; onClose?: () => void }) {
  const toneClass = tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
      <span className="flex-1">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="cursor-pointer text-xs underline underline-offset-4 opacity-80 hover:opacity-100">
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
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-neutral-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-(--ff-line) bg-(--ff-card) shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${width}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-(--ff-line) px-6">
          <h2 className="text-lg font-medium">{title}</h2>
          <button type="button" onClick={onClose} className={ui.btnGhost}>
            Đóng
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
