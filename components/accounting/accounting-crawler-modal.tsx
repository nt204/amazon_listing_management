"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  Play,
  Prohibit,
  Robot,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import type {
  AccountingCrawler,
  CrawlerJob,
  CrawlerJobStatus,
  CrawlerWorker,
} from "@/lib/accounting/crawler-jobs";
import { AccountingAnimatedModal } from "./accounting-skeleton";

interface CrawlerOverview {
  crawlers: {
    key: AccountingCrawler;
    label: string;
    description: string;
    schedule: string;
    dateHint: string;
    freshnessLabel: string;
    activeJob: CrawlerJob | null;
    lastJob: CrawlerJob | null;
    freshness: { store: string; latest: string | null }[];
  }[];
  jobs: CrawlerJob[];
  workers: CrawlerWorker[];
  stores: string[];
}

const CRAWLER_LABELS: Record<AccountingCrawler, string> = {
  accounting_daily: "Kế toán hằng ngày",
  accounting_monthly: "Báo cáo kế toán tháng",
  inventory_ledger: "Inventory Ledger FBA",
  awd_ledger: "AWD Ledger",
};

const STATUS_STYLES: Record<CrawlerJobStatus, { label: string; className: string }> = {
  PENDING: { label: "Đang chờ máy Mac", className: "bg-amber-50 text-amber-800 border-amber-200" },
  RUNNING: { label: "Đang chạy", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  COMPLETED: { label: "Hoàn tất", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  FAILED: { label: "Lỗi", className: "bg-rose-50 text-rose-700 border-rose-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

function StatusBadge({ status }: { status: CrawlerJobStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${style.className}`}>
      {status === "RUNNING" && <CircleNotch size={11} weight="bold" className="animate-spin" />}
      {status === "COMPLETED" && <CheckCircle size={11} weight="bold" />}
      {status === "FAILED" && <XCircle size={11} weight="bold" />}
      {style.label}
    </span>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d && m ? `${d}/${m}/${y}` : value;
}

function timeAgo(value: string | null | undefined) {
  if (!value) return "chưa từng";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} giây trước`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} giờ trước`;
  return `${Math.round(seconds / 86400)} ngày trước`;
}

function duration(job: CrawlerJob) {
  if (!job.claimed_at) return "—";
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  const minutes = Math.round((end - new Date(job.claimed_at).getTime()) / 60000);
  return minutes < 60 ? `${minutes} phút` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

function LogBox({ text }: { text: string | null }) {
  if (!text) return <p className="text-sm italic text-slate-400">Chưa có log.</p>;
  return (
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-2.5 font-mono text-xs leading-relaxed text-slate-100 thin-scrollbar">
      {text}
    </pre>
  );
}

function CrawlerCard({
  crawler,
  stores,
  workerHasScript,
  onRun,
  onCancel,
}: {
  crawler: CrawlerOverview["crawlers"][number];
  stores: string[];
  workerHasScript: boolean | undefined;
  onRun: (crawler: AccountingCrawler, storeName: string, targetDate: string) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
}) {
  const [storeName, setStoreName] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const active = crawler.activeJob;
  const last = crawler.lastJob;
  // Chỉ hiện store đã có dữ liệu (trong số store máy Mac crawl)
  const freshness = crawler.freshness.filter((item) => item.latest && stores.includes(item.store));

  const run = async () => {
    const scope = `${storeName || "tất cả store"}${targetDate ? `, ngày ${formatDay(targetDate)}` : ""}`;
    if (!confirm(`Chạy ngay "${crawler.label}" cho ${scope}?`)) return;
    setBusy(true);
    await onRun(crawler.key, storeName, targetDate);
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-bold text-slate-900">{crawler.label}</h4>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          <Clock size={13} weight="bold" />
          {crawler.schedule}
        </span>
      </div>

      <p className="text-sm text-slate-600">
        <span className="text-slate-500">Mới nhất: </span>
        {freshness.length ? (
          freshness.map((item, index) => (
            <span key={item.store}>
              {index > 0 && <span className="text-slate-300"> · </span>}
              {item.store} <strong className="tabular-nums text-slate-900">{formatDay(item.latest).slice(0, 5)}</strong>
            </span>
          ))
        ) : (
          <span className="text-slate-400">chưa có dữ liệu</span>
        )}
      </p>

      {workerHasScript === false && (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
          <WarningCircle size={16} weight="bold" />
          Máy Mac chưa có script của crawler này.
        </p>
      )}

      {active ? (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={active.status} />
              <span className="text-slate-700">
                {active.store_name || "Tất cả store"}
                {active.target_date ? ` · ${formatDay(active.target_date)}` : ""}
                {active.status === "RUNNING" ? ` · ${duration(active)}` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("Hủy lệnh này?")) return;
                await onCancel(active.id);
              }}
              disabled={active.cancel_requested}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
            >
              <Prohibit size={15} weight="bold" />
              {active.cancel_requested ? "Đang dừng..." : "Hủy"}
            </button>
          </div>
          {active.status === "RUNNING" && (
            <>
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                className="flex w-full items-center gap-1 text-left text-sm text-slate-700 hover:text-indigo-700 cursor-pointer"
                title="Xem log"
              >
                {showLog ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}
                <span className="min-w-0 truncate font-mono text-xs">{active.current_step || "Xem log"}</span>
              </button>
              {showLog && <LogBox text={active.log_tail} />}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            aria-label="Store"
            className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800"
          >
            <option value="">Tất cả store</option>
            {stores.map((store) => (
              <option key={store} value={store}>
                {store}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            aria-label="Ngày chốt sổ"
            title={crawler.dateHint}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800"
          />
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {busy ? <CircleNotch size={15} className="animate-spin" /> : <Play size={15} weight="fill" />}
            Chạy ngay
          </button>
          {last && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500" title={last.error_message ?? undefined}>
              Lần trước: <StatusBadge status={last.status} /> {formatDateTime(last.completed_at ?? last.created_at)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function AccountingCrawlerModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [data, setData] = useState<CrawlerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/crawler");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Không tải được trạng thái crawler.");
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Mở cửa sổ thì cập nhật 5 giây/lần để thấy tiến độ máy Mac
  useEffect(() => {
    if (!isOpen) return;
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isOpen, load]);

  const post = async (body: Record<string, unknown>, success: string) => {
    const res = await fetch("/api/accounting/crawler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(null);
      setError(json.error || "Thao tác thất bại.");
    } else {
      setError(null);
      setNotice(success);
    }
    await load();
  };

  const worker = data?.workers.find((w) => w.online) ?? data?.workers[0];
  const online = Boolean(worker?.online);

  return (
    <AccountingAnimatedModal isOpen={isOpen} onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
              <Robot size={22} weight="duotone" className="text-indigo-600" />
              Crawler kế toán
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                online ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              }`}
              title={worker ? `${worker.info?.hostname || worker.worker_id} · liên lạc ${timeAgo(worker.last_seen_at)}` : undefined}
            >
              <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-rose-500"}`} />
              Máy Mac {online ? "online" : "offline"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={load} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="Làm mới">
              <ArrowClockwise size={20} />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-4 thin-scrollbar">
          {!online && data && (
            <p
              className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
              title="Bật worker trên máy Mac: bash mac-crawler/install_accounting_worker_service.sh"
            >
              Máy Mac chưa kết nối — lệnh sẽ chờ đến khi máy Mac online.
            </p>
          )}
          {error && (
            <p className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              <WarningCircle size={14} weight="bold" /> {error}
            </p>
          )}
          {notice && !error && (
            <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              <CheckCircle size={14} weight="bold" /> {notice}
            </p>
          )}

          {!data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <CircleNotch size={18} className="animate-spin text-indigo-600" /> Đang tải trạng thái crawler...
            </div>
          ) : (
            <>
              {data.crawlers.map((crawler) => (
                <CrawlerCard
                  key={crawler.key}
                  crawler={crawler}
                  stores={data.stores}
                  workerHasScript={worker?.info?.scripts?.[crawler.key]}
                  onRun={(key, storeName, targetDate) =>
                    post(
                      { action: "run", crawler: key, store_name: storeName || null, target_date: targetDate || null },
                      online ? "Đã gửi lệnh, máy Mac sẽ nhận trong vài giây." : "Đã tạo lệnh, đang chờ máy Mac online.",
                    )
                  }
                  onCancel={(jobId) => post({ action: "cancel", job_id: jobId }, "Đã gửi yêu cầu hủy.")}
                />
              ))}

              <div className="rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Lịch sử</div>
                {data.jobs.length === 0 ? (
                  <p className="px-4 py-5 text-center text-sm text-slate-400">Chưa có lệnh nào.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">Tạo lúc</th>
                        <th className="px-3 py-1.5 font-semibold">Crawler</th>
                        <th className="px-3 py-1.5 font-semibold">Store</th>
                        <th className="px-3 py-1.5 font-semibold">Trạng thái</th>
                        <th className="px-3 py-1.5 font-semibold">Thời gian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.jobs.map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          expanded={expandedJob === job.id}
                          onToggle={() => setExpandedJob((current) => (current === job.id ? null : job.id))}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AccountingAnimatedModal>
  );
}

function JobRow({ job, expanded, onToggle }: { job: CrawlerJob; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-slate-50" title="Bấm để xem log">
        <td className="px-3 py-1.5 tabular-nums text-slate-600">
          <span className="inline-flex items-center gap-1">
            {expanded ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
            {formatDateTime(job.created_at)}
          </span>
        </td>
        <td className="px-3 py-1.5 font-semibold text-slate-800">{CRAWLER_LABELS[job.crawler] ?? job.crawler}</td>
        <td className="px-3 py-1.5 text-slate-600">
          {job.store_name || "Tất cả"}
          {job.target_date ? ` · ${formatDay(job.target_date)}` : ""}
        </td>
        <td className="px-3 py-1.5">
          <StatusBadge status={job.status} />
        </td>
        <td className="px-3 py-1.5 tabular-nums text-slate-600">{duration(job)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-3 py-2 space-y-1.5">
            {job.error_message && <p className="text-sm font-semibold text-rose-700">{job.error_message}</p>}
            <LogBox text={job.log_tail} />
          </td>
        </tr>
      )}
    </>
  );
}
