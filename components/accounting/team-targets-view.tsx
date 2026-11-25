"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { monthWeekBlocks, rangeLabel, type TargetKind, type TargetMetric } from "@/lib/accounting/team-targets";
import type { PendingDraftDto, TeamTargetDto } from "@/lib/accounting/team-targets-service";

// KPI kinh doanh → tab "Mục tiêu tuần": mục tiêu sếp giao cho team (qua Lark, tag bot) hoặc nhập tay ở đây.
// Báo cáo KPI ngày đọc các mục tiêu đang áp dụng để hiện cột Target tuần / % đạt tuần.

interface ListResponse {
  today: string;
  pendingDrafts: PendingDraftDto[];
  teams: string[];
  stores: Array<{ name: string; teams: string[] }>;
  targets: TeamTargetDto[];
}

const KIND_LABEL: Record<TargetKind, string> = {
  week_total: "Tổng tuần",
  daily_rate: "Mỗi ngày",
  month_total: "Tổng tháng / khoảng ngày",
  margin_floor: "Margin tối thiểu",
};
const METRIC_LABEL: Record<Exclude<TargetMetric, "margin">, string> = { units: "Units", revenue: "Revenue ($)", profit: "Profit ($)" };

function fmtValue(t: { metric: TargetMetric; value: number; comparator?: string; kind: TargetKind }) {
  const n = Math.round(t.value).toLocaleString("en-US");
  const v = t.metric === "margin" ? `${t.value}%` : t.metric === "units" ? `${n} units` : `$${n}`;
  return `${t.comparator === "=" ? "" : "≥ "}${v}${t.kind === "daily_rate" ? "/ngày" : ""}`;
}

/** Tuần T2 → CN của tháng trước, tháng này và 2 tháng tới — để chọn nhanh khi thêm mục tiêu tuần. */
function weekOptions(today: string) {
  const [y, m] = today.split("-").map(Number);
  const out: Array<{ start: string; end: string; label: string }> = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const month = d.toISOString().slice(0, 7);
    monthWeekBlocks(month).forEach((b, k) =>
      out.push({ start: b.startDate, end: b.endDate, label: `Tuần ${k + 1} T${Number(month.slice(5))} · ${rangeLabel(b.startDate, b.endDate)}` }),
    );
  }
  return out;
}

type Status = "running" | "upcoming" | "past";
const statusOf = (t: TeamTargetDto, today: string): Status =>
  t.startDate > today ? "upcoming" : t.endDate && t.endDate < today ? "past" : "running";
const STATUS_UI: Record<Status, { label: string; cls: string }> = {
  running: { label: "Đang chạy", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  upcoming: { label: "Sắp tới", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  past: { label: "Đã qua", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

interface FormState {
  team: string;
  kind: TargetKind;
  metric: Exclude<TargetMetric, "margin">;
  storeName: string;
  startDate: string;
  endDate: string;
  value: string;
}

const input = "h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden";
const btn = "flex h-8 cursor-pointer items-center gap-1 rounded-lg px-3 text-xs font-bold transition-colors disabled:opacity-50";

function TargetForm({
  initial,
  data,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  data: ListResponse;
  submitLabel: string;
  onSubmit: (f: FormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weeks = useMemo(() => weekOptions(data.today), [data.today]);
  const stores = data.stores.filter((s) => s.teams.includes(f.team));
  const set = (patch: Partial<FormState>) => setF((p) => ({ ...p, ...patch }));
  const weekKey = weeks.find((w) => w.start === f.startDate && w.end === f.endDate)?.start ?? "";

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          Team
          <select className={input} value={f.team} onChange={(e) => set({ team: e.target.value, storeName: "" })}>
            {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          Loại
          <select className={input} value={f.kind} onChange={(e) => set({ kind: e.target.value as TargetKind })}>
            {(Object.keys(KIND_LABEL) as TargetKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {f.kind !== "margin_floor" && (
          <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
            Chỉ số
            <select className={input} value={f.metric} onChange={(e) => set({ metric: e.target.value as FormState["metric"] })}>
              {(Object.keys(METRIC_LABEL) as Array<FormState["metric"]>).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
            </select>
          </label>
        )}
        {f.kind === "week_total" || f.kind === "daily_rate" ? (
          <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
            Tuần (T2 → CN)
            <select
              className={input}
              value={weekKey}
              onChange={(e) => {
                const w = weeks.find((x) => x.start === e.target.value);
                if (w) set({ startDate: w.start, endDate: w.end });
              }}
            >
              <option value="">Chọn tuần…</option>
              {weeks.map((w) => <option key={w.start} value={w.start}>{w.label}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
              Từ ngày
              <input type="date" className={input} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
              {f.kind === "margin_floor" ? "Đến ngày (bỏ trống = tới khi có mức mới)" : "Đến ngày"}
              <input type="date" className={input} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          Store (bỏ trống = cả team)
          <select className={input} value={f.storeName} onChange={(e) => set({ storeName: e.target.value })}>
            <option value="">Cả team</option>
            {stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          {f.kind === "margin_floor" ? "Margin tối thiểu (%)" : "Mục tiêu"}
          <input
            type="number"
            min={0}
            inputMode="decimal"
            className={`${input} w-28 text-right`}
            value={f.value}
            onChange={(e) => set({ value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={submit} disabled={saving} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            {saving ? "Đang lưu…" : submitLabel}
          </button>
          <button type="button" onClick={onCancel} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            Huỷ
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Mục tiêu mới trùng team, loại, store và khoảng ngày với mục tiêu cũ sẽ <b>thay</b> mục tiêu cũ.
      </p>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

const fmtUnits = (v: number) => `${Math.round(v).toLocaleString("en-US")} units`;

/** Tin nhắn gốc, đọc lại được (giữ xuống dòng). */
function MessageQuote({ text }: { text: string }) {
  return (
    <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
      {text}
    </blockquote>
  );
}

/** 1 tin nhắn tag bot đang chờ xác nhận: tin gốc, các tuần + số units, chọn team rồi Lưu / Huỷ. */
function PendingDraftCard({
  draft,
  teams,
  onDecide,
}: {
  draft: PendingDraftDto;
  teams: string[];
  onDecide: (id: string, action: "confirm" | "cancel", team?: string) => Promise<void>;
}) {
  const [team, setTeam] = useState(draft.team ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "confirm" | "cancel") => {
    if (action === "confirm" && !team) return setError("Chọn team trước khi lưu.");
    setBusy(true);
    setError(null);
    try {
      await onDecide(draft.id, action, team);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <div className="text-[11px] font-semibold text-slate-500">
        {draft.sender ?? "Tin nhắn"} · {draft.createdAt}
      </div>
      <MessageQuote text={draft.message} />
      <div className="text-xs text-slate-800">
        {draft.weeks.length ? (
          draft.weeks.map((w) => (
            <div key={w.startDate}>
              {w.label} ({rangeLabel(w.startDate, w.endDate)}): <b>{fmtUnits(w.value)}</b>
            </div>
          ))
        ) : (
          <div className="text-slate-500">Không có mục tiêu units theo tuần.</div>
        )}
        {draft.others.length > 0 && (
          <div className="mt-1 text-[11px] text-slate-500">
            Chỉ lưu lại (chưa vào báo cáo): {draft.others.map((o) => `${o.label} ${fmtValue({ ...o, comparator: ">=" })}`).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">Chọn team…</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" disabled={busy} onClick={() => run("confirm")} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          ✅ Lưu
        </button>
        <button type="button" disabled={busy} onClick={() => run("cancel")} className={`${btn} border border-red-200 bg-white text-red-600 hover:bg-red-50`}>
          Huỷ
        </button>
        {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      </div>
    </div>
  );
}

export function TeamTargetsView() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const fetchList = useCallback(async (): Promise<ListResponse> => {
    const res = await fetch("/api/accounting/team-targets", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Không tải được mục tiêu.");
    return json as ListResponse;
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await fetchList());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [fetchList]);

  useEffect(() => {
    let ignore = false;
    fetchList()
      .then((json) => !ignore && setData(json))
      .catch((err) => !ignore && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      ignore = true;
    };
  }, [fetchList]);

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error || "Không lưu được.");
    await load();
  };

  const toBody = (f: FormState) => ({
    team: f.team,
    kind: f.kind,
    metric: f.kind === "margin_floor" ? "margin" : f.metric,
    storeName: f.storeName || null,
    startDate: f.startDate,
    endDate: f.endDate || null,
    value: Number(f.value),
  });

  const remove = async (t: TeamTargetDto) => {
    if (!window.confirm(`Xoá mục tiêu "${t.label}" của ${t.team}? Báo cáo ngày sẽ không còn tính mục tiêu này.`)) return;
    try {
      await send(`/api/accounting/team-targets/${t.id}`, "DELETE");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return data.targets
      .filter((t) => !team || t.team === team)
      .filter((t) => showPast || statusOf(t, data.today) !== "past")
      .sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }) || a.startDate.localeCompare(b.startDate) || a.kind.localeCompare(b.kind));
  }, [data, team, showPast]);

  if (error) return <div className="p-4 text-sm font-semibold text-red-600">{error}</div>;
  if (!data) return <div className="p-4 text-sm text-slate-500">Đang tải…</div>;

  const firstWeek = weekOptions(data.today).find((w) => w.end >= data.today);
  const blankForm: FormState = {
    team: team || data.teams[0] || "",
    kind: "week_total",
    metric: "units",
    storeName: "",
    startDate: firstWeek?.start ?? data.today,
    endDate: firstWeek?.end ?? data.today,
    value: "",
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
        <b className="text-slate-900">Mục tiêu sếp giao cho team.</b> Sếp tag bot trên Lark (vd &quot;tuần cuối tháng 11 tối thiểu 3000 unit&quot;),
        tin phải ghi rõ team (vd &quot;team 3: …&quot;), leader bấm <b>Lưu</b> trên card — hoặc thêm / sửa ngay ở đây.
        Trước mắt báo cáo KPI ngày chỉ theo dõi <b>Units từng tuần</b> (cột <b>Target tuần</b> / <b>% đạt tuần</b>); các mục tiêu khác chỉ lưu lại.
        Tuần tính T2 → CN, đủ 7 ngày. Xoá qua Lark: tag bot &quot;xoá mục tiêu&quot;.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["", ...data.teams].map((t) => (
          <button
            key={t || "all"}
            type="button"
            onClick={() => setTeam(t)}
            className={`${btn} border ${team === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {t || "Tất cả"}
          </button>
        ))}
        <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          Hiện cả mục tiêu đã qua
        </label>
        <button
          type="button"
          onClick={() => { setAdding(true); setEditing(null); }}
          className={`${btn} ml-auto bg-blue-600 text-white hover:bg-blue-700`}
        >
          <PlusIcon size={13} weight="bold" /> Thêm mục tiêu
        </button>
      </div>

      {data.pendingDrafts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold text-amber-700">⏳ Chờ xác nhận ({data.pendingDrafts.length})</div>
          {data.pendingDrafts.map((d) => (
            <PendingDraftCard
              key={d.id}
              draft={d}
              teams={data.teams}
              onDecide={(id, action, t) => send(`/api/accounting/team-targets/drafts/${id}`, "POST", { action, team: t })}
            />
          ))}
        </div>
      )}

      {adding && (
        <TargetForm
          initial={blankForm}
          data={data}
          submitLabel="Lưu mục tiêu"
          onCancel={() => setAdding(false)}
          onSubmit={async (f) => {
            await send("/api/accounting/team-targets", "POST", toBody(f));
            setAdding(false);
          }}
        />
      )}

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Mục tiêu</th>
              <th className="px-3 py-2">Khoảng ngày</th>
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2 text-right">Chỉ tiêu</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Nguồn</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Chưa có mục tiêu nào{team ? ` cho ${team}` : ""}. Báo cáo ngày vẫn gửi như bình thường.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const st = STATUS_UI[statusOf(t, data.today)];
              if (editing === t.id) {
                return (
                  <tr key={t.id}>
                    <td colSpan={8} className="p-2">
                      <TargetForm
                        initial={{
                          team: t.team,
                          kind: t.kind,
                          metric: t.metric === "margin" ? "units" : t.metric,
                          storeName: t.storeName ?? "",
                          startDate: t.startDate,
                          endDate: t.endDate ?? "",
                          value: String(t.value),
                        }}
                        data={data}
                        submitLabel="Lưu thay đổi"
                        onCancel={() => setEditing(null)}
                        onSubmit={async (f) => {
                          await send(`/api/accounting/team-targets/${t.id}`, "PATCH", toBody(f));
                          setEditing(null);
                        }}
                      />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-900">{t.team}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{t.label}</div>
                    <div className="text-[11px] text-slate-400">
                      {KIND_LABEL[t.kind]}
                      {t.kind === "week_total" && t.metric === "units" ? (
                        <span className="ml-1 font-semibold text-emerald-600">· vào báo cáo ngày</span>
                      ) : (
                        <span className="ml-1">· chỉ lưu, chưa vào báo cáo</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {t.endDate ? rangeLabel(t.startDate, t.endDate) : `${rangeLabel(t.startDate, null)} (tới khi có mức mới)`}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{t.storeName ?? <span className="text-slate-400">Cả team</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-slate-900">
                    {fmtValue(t)}
                    {t.isEstimate && <span className="ml-1 font-normal text-slate-400">(dự kiến)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="w-[300px] max-w-[300px] px-3 py-2 align-top text-[11px] text-slate-500">
                    <div>{t.updatedBy ? `Sửa bởi ${t.updatedBy}` : `Lưu bởi ${t.createdBy ?? "—"}`}</div>
                    {t.message ? (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer font-semibold text-blue-600 hover:underline">Tin nhắn gốc</summary>
                        <div className="mt-1"><MessageQuote text={t.message} /></div>
                      </details>
                    ) : (
                      <div className="text-slate-400">Nhập trên web</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      title="Sửa"
                      onClick={() => { setEditing(t.id); setAdding(false); }}
                      className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                    >
                      <PencilSimpleIcon size={14} />
                    </button>
                    <button
                      type="button"
                      title="Xoá"
                      onClick={() => remove(t)}
                      className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
