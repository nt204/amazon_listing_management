"use client";

import { ArrowClockwiseIcon, HeartbeatIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { HealthLevel, HealthMetric, ServerHealthReport } from "@/lib/server-health";

const REFRESH_MS = 60_000;

const levelStyle: Record<HealthLevel, { label: string; text: string; bar: string; dot: string; badge: string }> = {
  healthy: { label: "Ổn định", text: "text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700" },
  warning: { label: "Cần chú ý", text: "text-amber-700", bar: "bg-amber-500", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700" },
  critical: { label: "Nguy hiểm", text: "text-red-700", bar: "bg-red-500", dot: "bg-red-500", badge: "bg-red-50 text-red-700" },
};

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  if (hours < 1) return `${Math.max(1, Math.floor(seconds / 60))} phút`;
  if (hours < 48) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

function formatMb(bytes: number) {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

function MetricRow({ label, metric }: { label: string; metric: HealthMetric }) {
  const style = levelStyle[metric.level];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold text-slate-700">{label}</span>
        <span className={`text-sm font-black tabular-nums ${style.text}`}>
          {metric.percent !== null ? `${metric.percent}%` : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${style.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, metric.percent ?? 0))}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{metric.detail}</p>
    </div>
  );
}

function ServerHealthContent({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<ServerHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/server-health", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Partial<ServerHealthReport> & { error?: string };
      if (!response.ok || !body.disk) throw new Error(body.error || "Không thể tải sức khỏe server.");
      setReport(body as ServerHealthReport);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải sức khỏe server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const overall = report ? levelStyle[report.level] : null;

  return (
    <div
      className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
          <HeartbeatIcon size={19} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="server-health-title" className="text-sm font-extrabold text-slate-900">Sức khỏe server</h2>
          <p className="truncate text-[11px] text-slate-500">
            {report
              ? `Chạy ${formatUptime(report.uptimeSeconds)} · cập nhật ${new Date(report.checkedAt).toLocaleTimeString("vi-VN")}`
              : error ? "Không tải được dữ liệu" : "Đang kiểm tra…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title="Kiểm tra lại"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
        >
          <ArrowClockwiseIcon size={15} weight="bold" className={loading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Đóng"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <XIcon size={16} weight="bold" />
        </button>
      </header>

      <div className="space-y-5 overflow-y-auto px-5 py-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-red-700" role="alert">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={16} weight="fill" />
            <p className="text-xs font-semibold">{error}</p>
          </div>
        ) : null}

        {!report && !error ? (
          <div className="space-y-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : null}

        {report && overall ? (
          <>
            <div className={`rounded-xl px-3 py-2 text-xs font-extrabold ${overall.badge}`}>
              Tình trạng chung: {overall.label}
            </div>

            <div className="space-y-4">
              <MetricRow label="Ổ đĩa" metric={report.disk} />
              <MetricRow label="RAM" metric={report.memory} />
              <MetricRow label="CPU" metric={report.cpu} />
            </div>

            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {report.services.map((service) => (
                <li key={service.name} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="flex items-center gap-2 font-bold text-slate-700">
                    <span className={`h-2 w-2 rounded-full ${levelStyle[service.level].dot}`} />
                    {service.name}
                  </span>
                  <span className="text-slate-500">{service.detail}</span>
                </li>
              ))}
            </ul>

            {report.processes && report.processes.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tiến trình</p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {report.processes.map((item) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${item.online ? "bg-emerald-500" : "bg-red-500"}`} />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {item.online ? formatMb(item.memoryBytes) : "Đã dừng"} · {item.restarts} restart
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Chỉ dành cho admin; chỉ gọi API khi modal đang mở. */
export function ServerHealthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="server-health-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <ServerHealthContent onClose={onClose} />
    </div>,
    document.body,
  );
}
