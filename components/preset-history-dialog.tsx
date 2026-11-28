"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  ClockCounterClockwiseIcon,
  SpinnerIcon,
  XIcon,
} from "@phosphor-icons/react";
import type {
  MockupContentItem,
  ProductCategoryPreset,
  SharedMockupPresetVersion,
} from "../types/mockup-preset";
import { fetchPresetVersions, restorePresetVersion } from "../lib/mockup-preset-store";

interface PresetHistoryDialogProps {
  preset: ProductCategoryPreset;
  /** Phôi còn thay đổi chưa lưu lên server thì không cho khôi phục. */
  hasPendingSave: (presetId: string) => boolean;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}

interface ContentChange {
  id: number;
  label: string;
  kind: "added" | "removed" | "changed";
  before?: MockupContentItem;
  after?: MockupContentItem;
}

function contentChanged(a: MockupContentItem, b: MockupContentItem) {
  return (
    a.label !== b.label ||
    a.checked !== b.checked ||
    (a.promptKey || "") !== (b.promptKey || "") ||
    (a.customPrompt || "").trim() !== (b.customPrompt || "").trim()
  );
}

/** So hai danh sách Content, trả về những Content khác nhau. */
function diffContents(
  before: readonly MockupContentItem[],
  after: readonly MockupContentItem[],
): ContentChange[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const ids = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort(
    (a, b) => a - b,
  );
  const changes: ContentChange[] = [];
  for (const id of ids) {
    const b = beforeById.get(id);
    const a = afterById.get(id);
    if (b && !a) changes.push({ id, label: b.label, kind: "removed", before: b });
    else if (!b && a) changes.push({ id, label: a.label, kind: "added", after: a });
    else if (a && b && contentChanged(b, a)) {
      changes.push({ id, label: a.label, kind: "changed", before: b, after: a });
    }
  }
  return changes;
}

/** Một dòng tóm tắt bản này đã đổi gì so với bản liền trước. */
function summarize(
  version: SharedMockupPresetVersion,
  previous: SharedMockupPresetVersion | undefined,
) {
  if (version.source === "baseline" && !previous) return "Bản đầu tiên được lưu";
  if (!previous) return "Bản cũ nhất còn giữ";
  const parts: string[] = [];
  if (version.label !== previous.label || version.icon !== previous.icon) {
    parts.push("đổi tên/icon");
  }
  const changes = diffContents(previous.contents, version.contents);
  const pick = (kind: ContentChange["kind"]) =>
    changes.filter((change) => change.kind === kind).map((change) => change.id);
  const changed = pick("changed");
  const added = pick("added");
  const removed = pick("removed");
  if (changed.length) parts.push(`sửa Content ${changed.join(", ")}`);
  if (added.length) parts.push(`thêm Content ${added.join(", ")}`);
  if (removed.length) parts.push(`xoá Content ${removed.join(", ")}`);
  const text = parts.length ? parts.join(" · ") : "không đổi nội dung";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}

function relativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  return `${days} ngày trước`;
}

type DiffPart = { text: string; type: "same" | "removed" | "added" };

/**
 * So hai đoạn prompt theo từ (LCS), để tô chỗ bị xoá / được thêm.
 * Prompt quá dài thì trả về null và chỉ hiện nguyên văn.
 */
function diffWords(before: string, after: string): DiffPart[] | null {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length * b.length > 6_000_000) return null;
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (text: string, type: DiffPart["type"]) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ text, type });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], "same");
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i], "removed");
      i += 1;
    } else {
      push(b[j], "added");
      j += 1;
    }
  }
  while (i < n) push(a[i++], "removed");
  while (j < m) push(b[j++], "added");
  return parts;
}

function DiffText({ parts, side }: { parts: DiffPart[]; side: "before" | "after" }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "same") return <span key={index}>{part.text}</span>;
        if (side === "before" && part.type === "removed") {
          return (
            <span key={index} className="rounded-sm bg-red-100 text-red-700 line-through decoration-red-400">
              {part.text}
            </span>
          );
        }
        if (side === "after" && part.type === "added") {
          return (
            <span key={index} className="rounded-sm bg-emerald-100 font-semibold text-emerald-800">
              {part.text}
            </span>
          );
        }
        return null;
      })}
    </>
  );
}

function ChangeBody({ change, versionNumber }: { change: ContentChange; versionNumber?: number }) {
  const beforeText = change.before ? promptText(change.before) : "";
  const afterText = change.after ? promptText(change.after) : "";
  const parts = change.kind === "changed" ? diffWords(beforeText, afterText) : null;
  const labelChanged =
    change.kind === "changed" && change.before?.label !== change.after?.label;
  const checkedChanged =
    change.kind === "changed" && change.before?.checked !== change.after?.checked;
  return (
    <>
      {(labelChanged || checkedChanged) && (
        <div className="space-y-0.5 border-b border-slate-100 px-3 py-2 text-[11px]">
          {labelChanged && (
            <p>
              <span className="font-bold text-slate-500">Tên: </span>
              <span className="text-red-600 line-through">{change.before?.label}</span>
              {" → "}
              <span className="font-semibold text-emerald-700">{change.after?.label}</span>
            </p>
          )}
          {checkedChanged && (
            <p className="font-semibold text-slate-600">
              {change.after?.checked ? "Sẽ bật chọn sẵn Content này" : "Sẽ bỏ chọn sẵn Content này"}
            </p>
          )}
        </div>
      )}
      {beforeText === afterText && change.kind === "changed" ? null : (
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
          <div className="bg-white p-3">
            <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Hiện tại</p>
            <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">
              {!change.before ? "—" : parts ? <DiffText parts={parts} side="before" /> : beforeText}
            </p>
          </div>
          <div className="bg-emerald-50/40 p-3">
            <p className="mb-1 text-[10px] font-bold uppercase text-emerald-600">
              Bản #{versionNumber}
            </p>
            <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-800">
              {!change.after ? "—" : parts ? <DiffText parts={parts} side="after" /> : afterText}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function promptText(item: MockupContentItem | undefined) {
  if (!item) return "";
  const prompt = (item.customPrompt || "").trim();
  if (prompt) return prompt;
  return item.promptKey ? `(Dùng prompt mặc định: ${item.promptKey})` : "(Trống)";
}

export function PresetHistoryDialog({
  preset,
  hasPendingSave,
  onClose,
  onRestored,
}: PresetHistoryDialogProps) {
  const [versions, setVersions] = useState<SharedMockupPresetVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const loaded = await fetchPresetVersions(preset.id);
      setVersions(loaded);
      setError("");
      setSelectedId((current) =>
        current && loaded.some((version) => version.id === current)
          ? current
          : loaded[1]?.id || loaded[0]?.id || null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được lịch sử.");
    } finally {
      setLoading(false);
    }
  }, [preset.id]);

  useEffect(() => {
    // setState trong load() chỉ chạy sau await fetch, không đồng bộ.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !restoring) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, restoring]);

  const current = versions[0];
  const selected = versions.find((version) => version.id === selectedId);
  const selectedIsCurrent = Boolean(selected && current && selected.id === current.id);
  const versionNumberById = useMemo(
    () => new Map(versions.map((version, index) => [version.id, versions.length - index])),
    [versions],
  );

  // So bản đang chọn với phôi đang dùng: bấm khôi phục sẽ đổi đúng những chỗ này.
  const changesVsCurrent = useMemo(() => {
    if (!selected) return [];
    return diffContents(preset.contents, selected.contents);
  }, [preset.contents, selected]);
  const labelChanged = Boolean(
    selected && (selected.label !== preset.label || selected.icon !== preset.icon),
  );

  const handleRestore = async () => {
    if (!selected || selectedIsCurrent) return;
    if (hasPendingSave(preset.id)) {
      setError("Phôi đang có thay đổi chưa lưu xong. Đợi vài giây rồi thử lại.");
      return;
    }
    const number = versionNumberById.get(selected.id);
    if (
      !window.confirm(
        `Khôi phục "${preset.label}" về bản #${number} (${formatTime(selected.savedAt)})?\n\n` +
          "Bản hiện tại vẫn được giữ trong lịch sử, có thể khôi phục lại bất cứ lúc nào.",
      )
    ) {
      return;
    }
    setRestoring(true);
    setError("");
    try {
      await restorePresetVersion(preset.id, selected.id);
      await onRestored();
      await load();
      setSelectedId(null);
      setRestoredNotice(`Đã khôi phục về bản #${number}. Cả team dùng prompt này từ giờ.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Không khôi phục được.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs"
      onClick={() => !restoring && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-history-title"
        onClick={(event) => event.stopPropagation()}
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ClockCounterClockwiseIcon className="h-5 w-5 shrink-0 text-indigo-600" weight="bold" />
            <div className="min-w-0">
              <h4 id="preset-history-title" className="truncate text-sm font-black text-slate-900">
                Lịch sử prompt · {preset.icon} {preset.label}
              </h4>
              <p className="text-[11px] font-medium text-slate-500">
                Chọn một bản để xem khác gì so với hiện tại, rồi bấm Khôi phục.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label="Đóng"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {(error || restoredNotice) && (
          <div
            className={`border-b px-5 py-2 text-xs font-semibold ${
              error
                ? "border-red-100 bg-red-50 text-red-700"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || restoredNotice}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Danh sách bản */}
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-slate-100 md:max-h-none md:w-72 md:border-b-0 md:border-r">
            {loading && versions.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs font-semibold text-slate-500">
                <SpinnerIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Đang tải...
              </div>
            ) : versions.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs font-medium text-slate-500">
                Chưa có lịch sử. Lần lưu prompt tiếp theo sẽ được ghi lại ở đây.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {versions.map((version, index) => {
                  const isSelected = version.id === selectedId;
                  const isCurrent = index === 0;
                  return (
                    <li key={version.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(version.id);
                          setRestoredNotice("");
                        }}
                        className={`w-full px-4 py-2.5 text-left transition ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-slate-900">
                            #{versions.length - index}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {relativeTime(version.savedAt)}
                          </span>
                          {isCurrent && (
                            <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              Đang dùng
                            </span>
                          )}
                          {!isCurrent && version.source === "restore" && (
                            <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              Khôi phục
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-700">
                          {version.source === "restore" && version.restoredFromId
                            ? `Khôi phục về bản #${versionNumberById.get(version.restoredFromId) ?? "cũ"}`
                            : summarize(version, versions[index + 1])}
                        </p>
                        <p className="truncate text-[10px] font-medium text-slate-400">
                          {version.savedByName} · {formatTime(version.savedAt)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Chi tiết bản đang chọn */}
          <div className="flex min-h-0 flex-1 flex-col">
            {!selected ? (
              <p className="m-auto px-6 text-center text-xs font-medium text-slate-500">
                Chọn một bản ở danh sách bên trái.
              </p>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {selectedIsCurrent ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                      Đây là bản đang dùng. Chọn một bản cũ hơn để so sánh và khôi phục.
                    </p>
                  ) : changesVsCurrent.length === 0 && !labelChanged ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                      Bản này giống hệt bản đang dùng.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold text-slate-500">
                        Khôi phục sẽ đổi {changesVsCurrent.length} Content
                        {labelChanged ? " và tên/icon" : ""} như dưới đây:
                      </p>
                      {labelChanged && (
                        <div className="rounded-xl border border-slate-200 p-3 text-xs">
                          <span className="font-bold text-slate-500">Tên: </span>
                          <span className="text-red-600 line-through">
                            {preset.icon} {preset.label}
                          </span>
                          {" → "}
                          <span className="font-semibold text-emerald-700">
                            {selected.icon} {selected.label}
                          </span>
                        </div>
                      )}
                      {changesVsCurrent.map((change) => (
                        <div key={change.id} className="rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                            <span className="text-xs font-extrabold text-slate-900">
                              Content {change.id}
                            </span>
                            <span className="truncate text-[11px] font-medium text-slate-500">
                              {change.label}
                            </span>
                            {change.kind !== "changed" && (
                              <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                {change.kind === "added"
                                  ? "Sẽ thêm lại"
                                  : "Sẽ bỏ khỏi phôi"}
                              </span>
                            )}
                          </div>
                          <ChangeBody
                            change={change}
                            versionNumber={versionNumberById.get(selected.id)}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {!selectedIsCurrent && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <p className="text-[10px] font-medium text-slate-400">
                      Bản hiện tại vẫn được giữ lại trong lịch sử.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleRestore()}
                      disabled={restoring || (changesVsCurrent.length === 0 && !labelChanged)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restoring ? (
                        <SpinnerIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" weight="bold" />
                      )}
                      {restoring ? "Đang khôi phục..." : `Khôi phục bản #${versionNumberById.get(selected.id)}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
