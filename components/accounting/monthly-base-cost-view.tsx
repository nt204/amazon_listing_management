"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CalculatorIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FileXlsIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrendUpIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { YearlyBaseCostMonthCell, YearlyBaseCostRow } from "@/lib/accounting/inventory-db";
import {
  type ColumnConfig,
  DEFAULT_MONTHLY_BASE_COST_COLUMNS,
  ColumnHeaderCell,
} from "./column-manager-modal";

export interface MonthlyBaseCostViewRef {
  syncYear: () => void;
  reload: () => void;
}

interface MonthlyBaseCostViewProps {
  storeId: string;
  storeName?: string;
  year?: number;
  search?: string;
  tableZoom?: number;
  onYearChange?: (y: number) => void;
  onSyncingChange?: (syncing: boolean) => void;
  notify: (msg: string, type?: "success" | "error") => void;
  onOpenHistory?: (sku?: string) => void;
  columns?: ColumnConfig[];
  frozenThrough?: string;
  onFreezeColumn?: (colId: string) => void;
  onResizeColumn?: (colId: string, width: number) => void;
  onReorderColumns?: (sourceId: string, targetId: string) => void;
  onColumnContextMenu?: (field: string, x: number, y: number) => void;
  onAutoFitColumn?: (colId: string) => void;
}

function getColumnWidth(column?: ColumnConfig, fallback = 120): number {
  if (!column?.width) return fallback;
  if (typeof column.width === "number") return column.width;
  if (typeof column.width === "string") {
    const match = column.width.match(/w-\[(\d+)px\]/);
    if (match) return Number(match[1]);
    const num = parseInt(column.width, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return fallback;
}

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "$0.00";
  return `$${Number(val).toFixed(2)}`;
}

function formatCostNumber(val: number | null | undefined): string {
  if (val == null || isNaN(val) || val === 0) return "-";
  const num = Number(val);
  return num.toFixed(2);
}

/**
 * Component vẽ biểu đồ Sparkline dạng bậc thang (stepped line)
 * mô phỏng chính xác sự biến động Basecost qua 12 tháng như hình ảnh Google Sheets thực tế.
 */
function StepSparkline({ points, initialValue = 0 }: { points: number[]; initialValue?: number }) {
  const width = 110;
  const height = 34;
  const padX = 4;
  const padY = 4;

  // Mỗi giá trị là giá vốn áp dụng cho *cả tháng*, không phải một điểm tức thời.
  // Ô Basecost rỗng được API biểu diễn bằng 0, nhưng về nghiệp vụ nó có nghĩa là
  // "chưa phát sinh giá mới". Biểu đồ cần kế thừa giá gần nhất (giá 1/1 cho tháng đầu),
  // tránh tạo một spike giả từ $0 lên giá vốn thực tế.
  const initialKnownValue = Number.isFinite(initialValue) && initialValue > 0 ? initialValue : 0;
  const validPoints = Array.from({ length: 12 }, (_, index) => index).reduce<number[]>(
    (values, index) => {
      const value = Number(points?.[index]);
      const lastKnownValue = values.at(-1) ?? initialKnownValue;
      return [...values, Number.isFinite(value) && value > 0 ? value : lastKnownValue];
    },
    [],
  );
  const minVal = Math.min(...validPoints);
  const maxVal = Math.max(...validPoints);
  const range = maxVal - minVal;

  const pathD = useMemo(() => {
    if (range === 0) {
      // Flat line in the middle
      const y = height / 2;
      return `M ${padX} ${y} L ${width - padX} ${y}`;
    }

    const chartWidth = width - 2 * padX;
    const valueToY = (value: number) =>
      height - padY - ((value - minVal) / range) * (height - 2 * padY);
    const segments: string[] = [];

    // Giá trị tháng 1 bắt đầu từ mép trái; mỗi tháng chiếm chính xác 1/12 chiều rộng.
    // Khi sang tháng mới mới vẽ đoạn dọc, nên tháng 12 cũng có một đoạn ngang đầy đủ.
    let currentY = valueToY(validPoints[0]);
    segments.push(`M ${padX} ${currentY.toFixed(1)}`);
    for (let i = 0; i < validPoints.length; i++) {
      const monthEndX = padX + ((i + 1) / validPoints.length) * chartWidth;
      segments.push(`L ${monthEndX.toFixed(1)} ${currentY.toFixed(1)}`);

      if (i < validPoints.length - 1) {
        currentY = valueToY(validPoints[i + 1]);
        segments.push(`L ${monthEndX.toFixed(1)} ${currentY.toFixed(1)}`);
      }
    }
    return segments.join(" ");
  }, [validPoints, range, minVal, width, height]);

  return (
    <div
      className="relative flex items-center justify-center w-[110px] h-[34px] group cursor-pointer"
      title={`Biến động 12 tháng: Thấp nhất $${minVal.toFixed(2)} - Cao nhất $${maxVal.toFixed(2)}`}
    >
      <svg width={width} height={height} className="overflow-visible">
        <path
          d={pathD}
          fill="none"
          stroke="#475569"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-colors group-hover:stroke-blue-600"
        />
      </svg>
    </div>
  );
}

export const MonthlyBaseCostView = forwardRef<MonthlyBaseCostViewRef, MonthlyBaseCostViewProps>(
  function MonthlyBaseCostView(
    {
      storeId,
      storeName,
      year: propYear,
      search: propSearch = "",
      tableZoom = 100,
      onYearChange,
      onSyncingChange,
      notify,
      onOpenHistory,
      columns: propColumns,
      frozenThrough = "asin",
      onFreezeColumn,
      onResizeColumn,
      onReorderColumns,
      onColumnContextMenu,
      onAutoFitColumn,
    },
    ref,
  ) {
    const [year, setYearState] = useState<number>(propYear || 2026);
    const [rows, setRows] = useState<YearlyBaseCostRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncingYear, setSyncingYear] = useState(false);
    const [headerDragId, setHeaderDragId] = useState<string | null>(null);
    const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

    const activeColumns = useMemo(() => {
      const source = propColumns && propColumns.length > 0 ? propColumns : DEFAULT_MONTHLY_BASE_COST_COLUMNS;
      return source.filter((c) => c.visible !== false);
    }, [propColumns]);

    const freezeMap = useMemo(() => {
      const boundary = frozenThrough || "asin";
      const lastFrozenIndex = activeColumns.findIndex((c) => c.id === boundary);
      let leftSum = 0;
      const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};
      activeColumns.forEach((col, idx) => {
        const width = getColumnWidth(col);
        const isFrozen = lastFrozenIndex >= 0 && idx <= lastFrozenIndex;
        const isBoundary = lastFrozenIndex >= 0 && idx === lastFrozenIndex;
        map[col.id] = {
          isFrozen,
          isBoundary,
          left: isFrozen ? leftSum : 0,
          width,
        };
        if (isFrozen) {
          leftSum += width;
        }
      });
      return map;
    }, [activeColumns, frozenThrough]);

    const getCellFreezeProps = useCallback(
      (colId: string, isHeader = false) => {
        const freeze = freezeMap[colId];
        const width = freeze?.width || 120;
        if (!freeze || !freeze.isFrozen) {
          return {
            isFrozen: false,
            isBoundary: false,
            style: {
              width,
              minWidth: width,
              maxWidth: width,
            } as React.CSSProperties,
            className: "",
          };
        }
        const style: React.CSSProperties = {
          position: "sticky",
          left: freeze.left,
          zIndex: isHeader ? 40 : 20,
          width,
          minWidth: width,
          maxWidth: width,
        };
        const className = isHeader
          ? `bg-[#f59e0b] text-slate-950 ${
              freeze.isBoundary
                ? "border-r-2 !border-r-amber-900"
                : "border-r border-amber-600"
            }`
          : `bg-white dark:bg-slate-900 group-hover:bg-[#fef9c3] dark:group-hover:bg-slate-800 ${
              freeze.isBoundary
                ? "border-r-2 !border-r-slate-400 dark:!border-r-slate-600"
                : "border-r border-slate-300 dark:border-slate-700"
            }`;
        return {
          isFrozen: true,
          isBoundary: freeze.isBoundary,
          style,
          className,
        };
      },
      [freezeMap],
    );

    useEffect(() => {
      if (propYear && propYear !== year) {
        setYearState(propYear);
      }
    }, [propYear]);

    const setYear = (y: number) => {
      setYearState(y);
      onYearChange?.(y);
    };

    useEffect(() => {
      onSyncingChange?.(syncingYear);
    }, [syncingYear, onSyncingChange]);

    // Inline editing state
    const [editingCell, setEditingCell] = useState<{
      sku: string;
      field: "hang_ton" | "gia_von" | "reference_hang_ton" | "month";
      month?: number;
    } | null>(null);
    const [editValue, setEditValue] = useState<string>("");
    const [savingField, setSavingField] = useState(false);

    // Lightbox preview image state
    const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

    // Detail breakdown modal state for a specific month
    const [breakdownData, setBreakdownData] = useState<{
      row: YearlyBaseCostRow;
      month: number;
      cell: YearlyBaseCostMonthCell;
    } | null>(null);
    const [breakdownSlTon, setBreakdownSlTon] = useState<string>("");

    const handleOpenBreakdown = (row: YearlyBaseCostRow, month: number, cell: YearlyBaseCostMonthCell) => {
      setBreakdownData({ row, month, cell });
      setBreakdownSlTon(cell.sl_ton_dau_ky ? String(cell.sl_ton_dau_ky) : "");
    };

    const handleSaveBreakdownSlTon = async () => {
      if (!breakdownData || !storeId) return;
      const num = parseFloat(breakdownSlTon);
      if (isNaN(num) || num < 0) {
        notify("Vui lòng nhập số tồn kho hợp lệ >= 0", "error");
        return;
      }
      setSavingField(true);
      try {
        const res = await fetch("/api/accounting/inventory/monthly-base-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_monthly_sl_ton",
            store_id: storeId,
            year,
            sku: breakdownData.row.sku,
            month: breakdownData.month,
            sl_ton: num,
          }),
        });
        if (!res.ok) throw new Error("Lỗi khi lưu số lượng tồn.");
        notify(`Đã cập nhật số lượng tồn (${num}) và tự động tính lại Basecost!`, "success");
        setBreakdownData(null);
        fetchYearlyMatrix(year, propSearch);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setSavingField(false);
      }
    };

    // Fetch 12-month matrix data
    const fetchYearlyMatrix = async (targetYear = year, searchTerm = propSearch) => {
      if (!storeId) return;
      setLoading(true);
      try {
        const q = new URLSearchParams({
          store_id: storeId,
          year: String(targetYear),
          mode: "yearly",
        });
        if (searchTerm && searchTerm.trim()) {
          q.append("search", searchTerm.trim());
        }
        const res = await fetch(`/api/accounting/inventory/monthly-base-cost?${q}`);
        if (!res.ok) throw new Error("Không thể tải bảng ma trận Base Cost 12 tháng.");
        const data = await res.json();
        setRows(data.rows || []);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchYearlyMatrix(year, propSearch);
    }, [storeId, year, propSearch]);

    // Tự động tính 12 tháng từ Chi Tiết Đi Hàng (Cascade Calculation)
    const handleSyncYear = async () => {
      if (!storeId) return;
      setSyncingYear(true);
      try {
        const res = await fetch("/api/accounting/inventory/monthly-base-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_year",
            store_id: storeId,
            year,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Tính toán thất bại.");

        notify(`Đã tự động tính toán đồng bộ thành công cả 12 tháng của năm ${year}!`, "success");
        fetchYearlyMatrix(year, propSearch);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setSyncingYear(false);
      }
    };

    // Expose methods via ref for header action buttons
    useImperativeHandle(
      ref,
      () => ({
        syncYear: handleSyncYear,
        reload: () => fetchYearlyMatrix(year, propSearch),
      }),
      [storeId, year, propSearch],
    );

    // Save inline edit
    const handleSaveCell = async () => {
      if (!editingCell || !storeId) return;
      const num = parseFloat(editValue);
      if (isNaN(num) || num < 0) {
        notify("Vui lòng nhập số hợp lệ >= 0", "error");
        setEditingCell(null);
        return;
      }

      setSavingField(true);
      try {
        if (editingCell.field === "reference_hang_ton") {
          const res = await fetch("/api/accounting/inventory/monthly-base-cost", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update_monthly_sl_ton",
              store_id: storeId,
              year,
              sku: editingCell.sku,
              month: referenceMonth,
              sl_ton: num,
            }),
          });
          if (!res.ok) throw new Error("Lỗi khi lưu số lượng tồn đầu tháng.");
        } else if (editingCell.field === "hang_ton" || editingCell.field === "gia_von") {
          const payload: any = {
            action: "update_yearly_initial",
            store_id: storeId,
            year,
            sku: editingCell.sku,
          };
          if (editingCell.field === "hang_ton") payload.hang_ton = num;
          if (editingCell.field === "gia_von") payload.gia_von = num;

          const res = await fetch("/api/accounting/inventory/monthly-base-cost", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error("Lỗi khi lưu số liệu đầu năm.");
        } else if (editingCell.field === "month" && editingCell.month != null) {
          const res = await fetch("/api/accounting/inventory/monthly-base-cost", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update_yearly_month_cost",
              store_id: storeId,
              year,
              sku: editingCell.sku,
              month: editingCell.month,
              basecost: num,
            }),
          });
          if (!res.ok) throw new Error("Lỗi khi lưu Basecost tháng.");
        }

        notify("Đã cập nhật và tự động tính toán lại dữ liệu!", "success");
        setEditingCell(null);
        fetchYearlyMatrix(year, propSearch);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setSavingField(false);
      }
    };

    // Filter rows based on search query (SKU, ASIN, Product Type, Brand)
    const displayRows = useMemo(() => {
      if (!propSearch || !propSearch.trim()) return rows;
      const term = propSearch.trim().toLowerCase();
      return rows.filter(
        (r) =>
          r.sku.toLowerCase().includes(term) ||
          (r.asin && r.asin.toLowerCase().includes(term)) ||
          (r.product_type && r.product_type.toLowerCase().includes(term)) ||
          (r.brand && r.brand.toLowerCase().includes(term)),
      );
    }, [rows, propSearch]);

    // Summary statistics
    const stats = useMemo(() => {
      const totalSku = displayRows.length;
      let withCostCount = 0;
      let sumBaseCost = 0;
      let countBaseCost = 0;

      for (const r of displayRows) {
        if (r.gia_von_dau_nam > 0) withCostCount++;
        for (let m = 1; m <= 12; m++) {
          const cost = r.months[m]?.basecost;
          if (cost && cost > 0) {
            sumBaseCost += cost;
            countBaseCost++;
          }
        }
      }
      const avgCost = countBaseCost > 0 ? sumBaseCost / countBaseCost : 0;
      return {
        totalSku,
        withCostCount,
        avgCost,
      };
    }, [displayRows]);

    // Cột tham chiếu phải phản ánh tồn đầu của tháng đang theo dõi, tức tồn cuối
    // tháng trước trong Excel, thay vì luôn cố định ở ngày 1/1.
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const referenceMonth = currentMonth;
    const referenceMonthLabel = `tháng ${referenceMonth}/${year}`;
    const isFutureMonth = (month: number) => year > currentYear || (year === currentYear && month > currentMonth);

    return (
      <div className="flex flex-col flex-1 h-full min-h-0 bg-slate-50 dark:bg-slate-950">
        {/* Quick Summary Pill Bar */}
        <div className="flex items-center gap-4 px-4 py-2 text-xs bg-slate-100/70 dark:bg-slate-900/60 border-b border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400">
          <div>
            Tổng số SKU: <strong className="text-slate-900 dark:text-slate-100">{stats.totalSku}</strong>
          </div>
          <div>•</div>
          <div>
            SKU đã có giá vốn: <strong className="text-amber-700 dark:text-amber-300">{stats.withCostCount}</strong>
          </div>
          <div>•</div>
          <div>
            Basecost trung bình toàn năm:{" "}
            <strong className="text-blue-700 dark:text-blue-300 font-mono">${stats.avgCost.toFixed(2)}</strong>
          </div>
        </div>

      {/* Main Table Matching User Screenshot */}
      <div className="flex-1 overflow-auto bg-white dark:bg-slate-900 select-text">
        <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
          <table className="relative isolate w-full text-xs border-separate border-spacing-0 text-slate-800 dark:text-slate-200 min-w-[1380px] table-fixed">
            <colgroup>
              {activeColumns.map((c) => (
                <col key={c.id} style={{ width: getColumnWidth(c) }} />
              ))}
            </colgroup>
            {/* Header Row */}
            <thead className="sticky top-0 z-20 shadow-xs text-left">
              <tr className="h-10 text-xs select-none">
                {activeColumns.map((col) => {
                  const f = getCellFreezeProps(col.id, true);
                  const isOrange = ["product_type", "mockup", "sku", "asin"].includes(col.id);
                  const isYellow = ["reference_hang_ton", "reference_gia_von", "sparkline"].includes(col.id);
                  const headerBgClass = isOrange
                    ? "bg-[#ff9900] text-black border-r border-[#e68a00]"
                    : isYellow
                    ? "bg-[#fff2cc] dark:bg-amber-950/60 text-amber-950 dark:text-amber-200 border-r border-amber-200/80 dark:border-amber-900/60"
                    : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700";

                  let labelContent: React.ReactNode = col.label;
                  if (col.id === "reference_hang_ton") {
                    labelContent = (
                      <span>
                        Hàng tồn đầu<br />{referenceMonthLabel}
                      </span>
                    );
                  } else if (col.id === "reference_gia_von") {
                    labelContent = (
                      <span>
                        Trung bình giá đầu<br />{referenceMonthLabel}
                      </span>
                    );
                  } else if (col.id === "sparkline") {
                    labelContent = (
                      <span>
                        Biến động<br />basecost
                      </span>
                    );
                  } else if (col.id.startsWith("month_")) {
                    const m = Number(col.id.replace("month_", ""));
                    labelContent = (
                      <span>
                        Basecost<br />tháng {m}
                      </span>
                    );
                  }

                  return (
                    <ColumnHeaderCell
                      key={col.id}
                      col={col}
                      style={f.style}
                      isFrozen={f.isFrozen}
                      isBoundary={f.isBoundary}
                      draggable={!f.isFrozen}
                      isDragging={headerDragId === col.id}
                      isDragOver={headerDragOverId === col.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", col.id);
                        e.dataTransfer.effectAllowed = "move";
                        setHeaderDragId(col.id);
                      }}
                      onDragOver={(e) => {
                        if (!headerDragId || headerDragId === col.id || f.isFrozen) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (headerDragOverId !== col.id) {
                          setHeaderDragOverId(col.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (headerDragOverId === col.id) {
                          setHeaderDragOverId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (f.isFrozen) return;
                        const sourceId = e.dataTransfer.getData("text/plain") || headerDragId;
                        if (sourceId && sourceId !== col.id) {
                          onReorderColumns?.(sourceId, col.id);
                        }
                        setHeaderDragId(null);
                        setHeaderDragOverId(null);
                      }}
                      onDragEnd={() => {
                        setHeaderDragId(null);
                        setHeaderDragOverId(null);
                      }}
                      className={`px-2 font-bold text-center leading-tight select-none ${headerBgClass} ${f.className}`}
                      onResize={onResizeColumn ? (id, width) => onResizeColumn(id, width) : undefined}
                      onAutoFit={onAutoFitColumn}
                      onColumnClick={onColumnContextMenu ? (id, event) => onColumnContextMenu(id, event.clientX, event.clientY) : undefined}
                    >
                      <div className="w-full flex items-center justify-center text-center overflow-hidden">
                        <div className="line-clamp-2 break-words whitespace-normal leading-tight max-w-full" title={col.label}>
                          {labelContent}
                        </div>
                      </div>
                    </ColumnHeaderCell>
                  );
                })}
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ArrowClockwiseIcon className="w-6 h-6 animate-spin text-amber-500" />
                      <span>Đang tải ma trận Basecost {year}...</span>
                    </div>
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <PackageIcon className="w-8 h-8 text-slate-300" />
                      {propSearch ? (
                        <span>Không tìm thấy SKU nào khớp với từ khóa &ldquo;{propSearch}&rdquo;.</span>
                      ) : (
                        <>
                          <span>Không tìm thấy SKU nào trong năm {year}.</span>
                          <button
                            onClick={handleSyncYear}
                            className="mt-2 px-3 py-1.5 text-xs text-white bg-amber-500 hover:bg-amber-600 rounded-md shadow-sm"
                          >
                            Bấm để tự động tổng hợp từ Chi Tiết Đi Hàng
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                displayRows.map((r) => {
                  const mockupSrc = r.mockup_url || r.mockup;
                  const referenceCell = r.months[referenceMonth];
                  const referenceOpeningQty = referenceCell?.sl_ton_dau_ky ?? r.hang_ton_dau_nam;
                  const referenceOpeningCost = referenceCell?.basecost_dau_ky ?? r.gia_von_dau_nam;

                  return (
                    <tr
                      key={r.sku}
                      className="group hover:bg-slate-50/90 dark:hover:bg-slate-850/60 transition-colors h-11"
                    >
                      {activeColumns.map((col) => {
                        const f = getCellFreezeProps(col.id, false);
                        const cid = col.id;

                        if (cid === "product_type") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-3 py-1.5 text-center font-medium truncate ${
                                f.isFrozen
                                  ? f.className
                                  : "border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {r.product_type ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                  {r.product_type}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                          );
                        }

                        if (cid === "mockup") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-2 py-1 text-center ${
                                f.isFrozen
                                  ? f.className
                                  : "border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800"
                              }`}
                            >
                              {mockupSrc ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewImage({ url: mockupSrc, title: r.sku })}
                                  className="inline-block relative w-9 h-9 rounded overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90 hover:scale-105 transition-transform shadow-xs"
                                  title="Xem ảnh lớn"
                                >
                                  <img
                                    src={mockupSrc}
                                    alt={r.sku}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                </button>
                              ) : (
                                <div className="w-9 h-9 mx-auto rounded bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] text-slate-400">
                                  No Pic
                                </div>
                              )}
                            </td>
                          );
                        }

                        if (cid === "sku") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-3 py-1.5 font-mono font-bold tracking-tight whitespace-nowrap truncate ${
                                f.isFrozen
                                  ? f.className
                                  : "border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 text-slate-900 dark:text-slate-100"
                              }`}
                            >
                              {r.sku}
                            </td>
                          );
                        }

                        if (cid === "asin") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-3 py-1.5 font-mono font-medium text-center whitespace-nowrap truncate ${
                                f.isFrozen
                                  ? f.className
                                  : "border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                              }`}
                            >
                              {r.asin ? (
                                <a
                                  href={`https://www.amazon.com/dp/${r.asin}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {r.asin}
                                </a>
                              ) : (
                                "-"
                              )}
                            </td>
                          );
                        }

                        if (cid === "reference_hang_ton") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              onDoubleClick={() => {
                                setEditingCell({ sku: r.sku, field: "reference_hang_ton" });
                                setEditValue(String(referenceOpeningQty));
                              }}
                              className={`px-2 py-1.5 text-center font-medium ${
                                f.isFrozen
                                  ? f.className + " !bg-[#fffdf0] dark:!bg-[#2e1d05] text-slate-800 dark:text-slate-200"
                                  : "border-r border-amber-200/60 dark:border-amber-900/40 bg-[#fffdf0] dark:bg-amber-950/20 text-slate-800 dark:text-slate-200"
                              }`}
                              title={`Tồn đầu ${referenceMonthLabel}. Nhấp đúp để sửa.`}
                            >
                              {editingCell?.sku === r.sku && editingCell.field === "reference_hang_ton" ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveCell();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                  onBlur={handleSaveCell}
                                  className="w-16 px-1 py-0.5 text-xs text-center border border-blue-500 rounded bg-white dark:bg-slate-800"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCell({ sku: r.sku, field: "reference_hang_ton" });
                                    setEditValue(String(referenceOpeningQty));
                                  }}
                                  className="w-full cursor-pointer rounded hover:bg-amber-100/80 dark:hover:bg-amber-900/40"
                                  title="Sửa hàng tồn đầu tháng"
                                >
                                  {referenceOpeningQty}
                                </button>
                              )}
                            </td>
                          );
                        }

                        if (cid === "reference_gia_von") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-2 py-1.5 text-center font-semibold text-slate-900 dark:text-slate-100 ${
                                f.isFrozen
                                  ? f.className + " !bg-[#fffdf0] dark:!bg-[#2e1d05]"
                                  : "border-r border-amber-200/60 dark:border-amber-900/40 bg-[#fffdf0] dark:bg-amber-950/20"
                              }`}
                              title={`Giá vốn đầu ${referenceMonthLabel}`}
                            >
                              {referenceOpeningCost > 0 ? formatCurrency(referenceOpeningCost) : "-"}
                            </td>
                          );
                        }

                        if (cid === "sparkline") {
                          return (
                            <td
                              key={cid}
                              style={f.style}
                              className={`px-1 py-1 text-center ${
                                f.isFrozen
                                  ? f.className + " !bg-[#fffdf0] dark:!bg-[#2e1d05]"
                                  : "border-r border-amber-200/60 dark:border-amber-900/40 bg-[#fffdf0] dark:bg-amber-950/20"
                              }`}
                            >
                              <StepSparkline
                                points={r.sparkline_points}
                                initialValue={r.gia_von_dau_nam}
                              />
                            </td>
                          );
                        }

                        if (cid.startsWith("month_")) {
                          const m = Number(cid.replace("month_", ""));
                          const cell = r.months[m];
                          const isFuture = isFutureMonth(m);
                          const isEditing =
                            !isFuture &&
                            editingCell?.sku === r.sku &&
                            editingCell.field === "month" &&
                            editingCell.month === m;

                          return (
                            <td
                              key={cid}
                              style={f.style}
                              onDoubleClick={() => {
                                if (isFuture) return;
                                setEditingCell({ sku: r.sku, field: "month", month: m });
                                setEditValue(String(cell?.basecost || 0));
                              }}
                              onClick={(e) => {
                                if (!isFuture && (e.altKey || e.metaKey)) {
                                  setBreakdownData({ row: r, month: m, cell });
                                }
                              }}
                              className={`px-2 py-1.5 text-center relative group transition-colors ${
                                f.isFrozen ? f.className : "border-r border-slate-200 dark:border-slate-800"
                              } ${
                                isFuture
                                  ? "bg-slate-50/70 dark:bg-slate-900/30 text-slate-400 dark:text-slate-600 cursor-default"
                                  : "cursor-pointer " +
                                    (cell?.is_overridden
                                      ? "bg-amber-50/50 dark:bg-amber-950/20 font-bold text-amber-700 dark:text-amber-300"
                                      : "hover:bg-blue-50/60 dark:hover:bg-blue-950/20 text-slate-800 dark:text-slate-200 font-medium")
                              }`}
                              title={
                                isFuture
                                  ? `Tháng ${m}/${year} chưa tới nên chưa tính Basecost.`
                                  : `Tháng ${m}/${year}: Basecost = $${cell?.basecost?.toFixed(2) || "0.00"}${
                                      cell?.has_shipment ? " (Có chuyến hàng nhập về)" : ""
                                    }${cell?.is_overridden ? " (User đã sửa tay)" : ""}. Nhấp đúp để sửa.`
                              }
                            >
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveCell();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                  onBlur={handleSaveCell}
                                  className="w-14 px-1 py-0.5 text-xs text-center border border-blue-500 rounded bg-white dark:bg-slate-800"
                                />
                              ) : (
                                <div className="flex items-center justify-center gap-1">
                                  <span>{isFuture ? "-" : formatCostNumber(cell?.basecost)}</span>
                                  {!isFuture && cell?.has_shipment && (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                                      title="Tháng có hàng nhập về"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenBreakdown(r, m, cell);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-blue-600 transition cursor-pointer"
                                    title="Xem chi tiết & nhập số lượng tồn"
                                  >
                                    <InfoIcon size={12} weight="bold" />
                                  </button>
                                </div>
                              )}
                            </td>
                          );
                        }

                        return (
                          <td
                            key={cid}
                            style={f.style}
                            className={`px-2 py-1.5 text-center text-slate-500 ${f.isFrozen ? f.className : "border-r border-slate-200"}`}
                          >
                            -
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 2: Lightbox xem ảnh Mockup lớn */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs cursor-pointer"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-xl max-h-[85vh] bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-2xl p-2 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-3 right-3 p-1.5 bg-black/60 text-white rounded-full hover:bg-black transition-colors"
            >
              <XIcon className="w-4 h-4" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="w-full h-auto max-h-[75vh] object-contain rounded-lg"
            />
            <div className="px-3 py-2 text-center text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
              {previewImage.title}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Chi tiết tính toán Basecost của 1 tháng cụ thể */}
      {breakdownData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">
                  Chi tiết SKU: {breakdownData.row.sku}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tháng {breakdownData.month}/{year} (Kỳ {breakdownData.cell.period})
                </p>
              </div>
              <button
                onClick={() => setBreakdownData(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              {/* Nhập số lượng tồn đầu kỳ */}
              <div className="p-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-amber-950 dark:text-amber-200 block">
                      Số lượng tồn đầu kỳ (SL tồn):
                    </span>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Nhập số tồn kho thực tế nếu có để tự động tính bình quân với lô mới
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={breakdownSlTon}
                      onChange={(e) => setBreakdownSlTon(e.target.value)}
                      className="w-20 px-2 py-1 text-xs text-center font-bold bg-white dark:bg-slate-800 border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-2xs"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">cái</span>
                    <button
                      type="button"
                      disabled={savingField}
                      onClick={handleSaveBreakdownSlTon}
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded shadow-2xs cursor-pointer disabled:opacity-50 transition"
                    >
                      {savingField ? "Đang lưu..." : "Lưu & Tính lại"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg">
                <div>
                  <span className="text-slate-500">Tồn đầu kỳ đã lưu:</span>{" "}
                  <strong>{breakdownData.cell.sl_ton_dau_ky}</strong> cái
                </div>
                <div>
                  <span className="text-slate-500">Đơn giá tồn:</span>{" "}
                  <strong>${breakdownData.cell.basecost_dau_ky.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Nhập trong tháng:</span>{" "}
                  <strong>{breakdownData.cell.sl_nhap}</strong> cái
                </div>
                <div>
                  <span className="text-slate-500">Giá trị nhập:</span>{" "}
                  <strong>${breakdownData.cell.gtri_nhap.toFixed(2)}</strong>
                </div>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-lg space-y-1">
                <div className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                  KẾT QUẢ BASECOST THÁNG:
                </div>
                <div className="text-base font-bold font-mono text-blue-900 dark:text-blue-100">
                  ${breakdownData.cell.basecost.toFixed(2)}
                </div>
                <div className="text-[11px] text-blue-700 dark:text-blue-300 italic">
                  Quy tắc:{" "}
                  {breakdownData.cell.calculation_rule === "weighted_average"
                    ? "Bình quân gia quyền (Tồn cũ + Nhập mới)"
                    : breakdownData.cell.calculation_rule === "new_inbound_only"
                    ? "100% theo giá chuyến hàng mới (Tồn = 0)"
                    : "Tham chiếu tháng trước (Không có chuyến hàng mới)"}
                </div>
              </div>
            </div>

            <div className="flex justify-end px-5 py-3 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setBreakdownData(null)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-lg"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
