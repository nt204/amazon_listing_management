"use client";

/** Thanh phân trang dùng chung của các bảng Inventory. */
export function PaginationBar({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  onLimitChange,
  label = "mục",
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  onLimitChange?: (newLimit: number) => void;
  label?: string;
}) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(totalItems, page * limit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-[#f8fafc] px-4 py-2.5 text-xs text-slate-700 font-semibold select-none">
      <div className="flex items-center gap-3">
        <span>
          Hiển thị <strong className="text-slate-950 font-black">{startItem}–{endItem}</strong> / <strong className="text-slate-950 font-black">{totalItems.toLocaleString()}</strong> {label}
        </span>
        {onLimitChange && (
          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-300 pl-3">
            <span className="text-slate-500 text-[11px]">Mỗi trang:</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang đầu"
        >
          « Đầu
        </button>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang trước"
        >
          ‹ Trước
        </button>

        <div className="flex items-center gap-1 px-2 font-mono text-xs">
          <span className="text-slate-500">Trang</span>
          <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
            {page}
          </span>
          <span className="text-slate-500">/ {totalPages}</span>
        </div>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang sau"
        >
          Sau ›
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang cuối"
        >
          Cuối »
        </button>
      </div>
    </div>
  );
}
