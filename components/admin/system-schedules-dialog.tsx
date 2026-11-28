"use client";

import { CalendarBlankIcon, CaretDownIcon, XIcon } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import type { SystemSchedule, SystemSchedules } from "@/lib/admin/system-schedules";

const categories = [
  { id: "ppc", label: "PPC" },
  { id: "accounting", label: "Kế toán" },
] as const;

const kinds = ["Crawl", "Đồng bộ", "Thông báo", "Bảo trì"] as const satisfies readonly SystemSchedule["kind"][];
type ScheduleFilter = "all" | (typeof kinds)[number];
const kindColors: Record<SystemSchedule["kind"], { band: string; filter: string; dot: string }> = {
  Crawl: {
    band: "border-sky-200 bg-sky-100 text-sky-950",
    filter: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 aria-pressed:border-sky-700 aria-pressed:bg-sky-700 aria-pressed:text-white",
    dot: "bg-sky-600",
  },
  "Đồng bộ": {
    band: "border-emerald-200 bg-emerald-100 text-emerald-950",
    filter: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 aria-pressed:border-emerald-700 aria-pressed:bg-emerald-700 aria-pressed:text-white",
    dot: "bg-emerald-600",
  },
  "Thông báo": {
    band: "border-violet-200 bg-violet-100 text-violet-950",
    filter: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 aria-pressed:border-violet-700 aria-pressed:bg-violet-700 aria-pressed:text-white",
    dot: "bg-violet-600",
  },
  "Bảo trì": {
    band: "border-amber-200 bg-amber-100 text-amber-950",
    filter: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 aria-pressed:border-amber-800 aria-pressed:bg-amber-800 aria-pressed:text-white",
    dot: "bg-amber-600",
  },
};
const scheduleGrid = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)_6rem]";

function ScheduleRow({ schedule }: { schedule: SystemSchedule }) {
  return (
    <li className={`${scheduleGrid} gap-y-1 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:items-start sm:px-6`}>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="text-sm font-semibold leading-5 text-slate-900">{schedule.name}</p>
        {schedule.detail && <p className="mt-0.5 text-xs leading-5 text-slate-600">{schedule.detail}</p>}
      </div>
      <p className="text-xs font-semibold leading-5 text-slate-800 tabular-nums">{schedule.time}</p>
      <p className="text-right text-xs leading-5 text-slate-600 sm:text-left">{schedule.source}</p>
    </li>
  );
}

export function SystemSchedulesDialog({ schedules }: { schedules: SystemSchedules }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const listId = useId();
  const [category, setCategory] = useState<(typeof categories)[number]["id"]>("ppc");
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const visible = schedules[category].filter((schedule) => filter === "all" || schedule.kind === filter);
  const groups = kinds
    .map((kind) => ({ kind, schedules: visible.filter((schedule) => schedule.kind === kind && schedule.enabled !== false) }))
    .filter((group) => group.schedules.length > 0);
  const paused = visible.filter((schedule) => schedule.enabled === false);

  return (
    <>
      <button
        type="button"
        aria-label="Lịch tự động của hệ thống"
        aria-haspopup="dialog"
        title="Lịch tự động của hệ thống"
        onClick={() => dialog.current?.showModal()}
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-slate-200 bg-white text-indigo-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <CalendarBlankIcon size={17} weight="bold" aria-hidden />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="fixed inset-0 m-auto h-[min(90dvh,56rem)] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/40 open:flex open:animate-[acc-enter_200ms_cubic-bezier(0.16,1,0.3,1)_backwards] [--acc-enter-opacity:0] [--acc-enter-scale:0.98] motion-reduce:open:animate-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div>
            <h2 id={titleId} className="text-lg font-bold tracking-tight sm:text-2xl">Lịch tự động của hệ thống</h2>
            <p className="mt-0.5 text-xs text-slate-600">Giờ Việt Nam (UTC+7)</p>
          </div>
          <button
            type="button"
            aria-label="Đóng lịch"
            onClick={() => dialog.current?.close()}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
          >
            <XIcon size={16} weight="bold" aria-hidden />
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-200 px-4 pt-3 sm:px-6">
          <div role="group" aria-label="Danh mục lịch" className="flex gap-4 border-b border-slate-100">
            {categories.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={category === id}
                aria-controls={listId}
                onClick={() => { setCategory(id); setFilter("all"); }}
                className="-mb-px min-h-9 cursor-pointer border-b-2 border-transparent px-1.5 text-sm font-semibold text-slate-600 hover:text-indigo-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 aria-pressed:border-indigo-600 aria-pressed:text-indigo-800"
              >
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Lọc theo loại công việc" className="flex flex-wrap gap-1.5 py-2.5">
            {(["all", ...kinds] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={filter === kind}
                aria-controls={listId}
                onClick={() => setFilter(kind)}
                className={`group inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${kind === "all"
                  ? "border-slate-200 text-slate-700 hover:bg-slate-100 aria-pressed:border-slate-800 aria-pressed:bg-slate-800 aria-pressed:text-white"
                  : kindColors[kind].filter}`}
              >
                {kind !== "all" && <span aria-hidden className={`size-1.5 shrink-0 rounded-full group-aria-pressed:bg-white ${kindColors[kind].dot}`} />}
                {kind === "all" ? "Tất cả" : kind}
              </button>
            ))}
          </div>
        </div>

        <div key={`${category}:${filter}`} id={listId} role="region" aria-label="Danh sách lịch" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 [scrollbar-gutter:stable]">
          <div aria-hidden className={`${scheduleGrid} sticky top-0 z-10 hidden border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs font-semibold text-slate-600 sm:grid`}>
            <span>Công việc</span>
            <span>Lịch chạy</span>
            <span>Nơi chạy</span>
          </div>
          {groups.map((group) => (
            <section key={group.kind}>
              {filter === "all" && (
                <h3 className={`flex items-center gap-2 border-y px-4 py-2 text-xs font-bold sm:px-6 ${kindColors[group.kind].band}`}>
                  <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${kindColors[group.kind].dot}`} />
                  {group.kind} <span className="font-medium opacity-75">{group.schedules.length}</span>
                </h3>
              )}
              <ul>{group.schedules.map((schedule) => <ScheduleRow key={schedule.name} schedule={schedule} />)}</ul>
            </section>
          ))}
          {paused.length > 0 && (
            <details className="group border-t border-slate-200" open={groups.length === 0}>
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 sm:px-6 [&::-webkit-details-marker]:hidden">
                <CaretDownIcon size={13} className="-rotate-90 group-open:rotate-0" aria-hidden />
                Lịch đang tắt <span className="font-normal text-slate-500">{paused.length}</span>
              </summary>
              <ul>{paused.map((schedule) => <ScheduleRow key={schedule.name} schedule={schedule} />)}</ul>
            </details>
          )}
          {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-600 sm:px-6">Không có lịch thuộc loại này.</p>}
        </div>

        <p className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-slate-600 sm:px-6">
          Đối chiếu VPS và Mac mini ngày {schedules.externalSchedulesCheckedAt}. Lịch Web app theo cấu hình hiện tại.
        </p>
      </dialog>
    </>
  );
}
