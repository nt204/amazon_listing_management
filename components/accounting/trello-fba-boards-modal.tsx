"use client";

import { useEffect, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  KanbanIcon,
  LightningIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

interface TrelloBoardConfig {
  id: string;
  board_id: string;
  board_name: string;
  target_list_name: string;
  target_list_id: string | null;
  webhook_id: string | null;
  default_store_id: string | null;
  default_store_name: string | null;
  is_active: boolean;
  last_event_at: string | null;
  created_at: string;
}

interface StoreOption {
  id: string;
  name: string;
}

interface TrelloFbaBoardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function TrelloFbaBoardsModal({ isOpen, onClose, onSuccess }: TrelloFbaBoardsModalProps) {
  const [boards, setBoards] = useState<TrelloBoardConfig[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ boardId: string; message: string; details?: any } | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Form thêm board mới
  const [newUrlOrId, setNewUrlOrId] = useState("");
  const [newTargetListName, setNewTargetListName] = useState("ĐI HÀNG FBA");
  const [newDefaultStoreId, setNewDefaultStoreId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBoards = async () => {
    try {
      setLoading(true);
      setErrorNotice(null);
      const res = await fetch("/api/accounting/trello-boards", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải cấu hình boards");
      setBoards(data.boards || []);
      setStores(data.stores || []);
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchBoards();
      setSyncResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Thêm board mới
  const handleAddBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrlOrId.trim()) return;

    try {
      setIsSubmitting(true);
      setErrorNotice(null);
      const res = await fetch("/api/accounting/trello-boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urlOrId: newUrlOrId.trim(),
          targetListName: newTargetListName.trim() || "ĐI HÀNG FBA",
          defaultStoreId: newDefaultStoreId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi khi kết nối board");

      setNewUrlOrId("");
      setNewDefaultStoreId("");
      await fetchBoards();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Đồng bộ thủ công ngay lập tức
  const handleSyncNow = async (board: TrelloBoardConfig) => {
    try {
      setActionLoadingId(board.id);
      setSyncResult(null);
      setErrorNotice(null);

      const res = await fetch("/api/accounting/trello-boards/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: board.board_id,
          listId: board.target_list_id,
          defaultStoreId: board.default_store_id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ");

      setSyncResult({
        boardId: board.id,
        message: data.message,
        details: data,
      });

      await fetchBoards();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Bật/tắt hoặc thử lại webhook
  const handleToggleActive = async (board: TrelloBoardConfig) => {
    try {
      setActionLoadingId(board.id);
      setErrorNotice(null);

      const res = await fetch("/api/accounting/trello-boards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: board.id,
          isActive: !board.is_active,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi cập nhật");

      await fetchBoards();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Kích hoạt lại Webhook
  const handleRetryWebhook = async (board: TrelloBoardConfig) => {
    try {
      setActionLoadingId(board.id);
      setErrorNotice(null);

      const res = await fetch("/api/accounting/trello-boards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: board.id,
          retryWebhook: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi kích hoạt webhook");

      await fetchBoards();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Xóa cấu hình board
  const handleDeleteBoard = async (board: TrelloBoardConfig) => {
    if (!confirm(`Bạn có chắc muốn xóa cấu hình Board "${board.board_name}"? Hệ thống sẽ ngừng bắt Webhook cho board này.`)) {
      return;
    }

    try {
      setActionLoadingId(board.id);
      setErrorNotice(null);

      const res = await fetch(`/api/accounting/trello-boards?id=${board.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi xóa board");

      await fetchBoards();
    } catch (err: any) {
      setErrorNotice(err.message || String(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <KanbanIcon className="h-5 w-5" weight="bold" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Quản lý bảng Trello FBA</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Thông báo lỗi / thành công */}
        {errorNotice && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            <WarningCircleIcon className="h-4 w-4 shrink-0 text-red-600" weight="fill" />
            <span className="flex-1">{errorNotice}</span>
            <button onClick={() => setErrorNotice(null)} className="text-red-500 hover:text-red-700">
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {syncResult && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" weight="fill" />
            <div className="flex-1">
              <p className="font-semibold">{syncResult.message}</p>
              {syncResult.details?.skippedCards?.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-700">
                  <span className="font-medium">Thẻ chưa nạp ({syncResult.details.skippedCards.length}): </span>
                  {syncResult.details.skippedCards.map((c: any) => `${c.title} (${c.reason})`).join(", ")}
                </div>
              )}
            </div>
            <button onClick={() => setSyncResult(null)} className="text-emerald-500 hover:text-emerald-700">
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Nội dung danh sách */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Danh sách bảng đang kết nối */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Bảng đã kết nối ({boards.length})
              </span>
              <button
                onClick={fetchBoards}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <ArrowClockwiseIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </button>
            </div>

            {loading && boards.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Đang tải danh sách bảng...</div>
            ) : boards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <KanbanIcon className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-600">Chưa kết nối bảng Trello</p>
              </div>
            ) : (
              <div className="space-y-3">
                {boards.map((b) => {
                  const isActionLoading = actionLoadingId === b.id;
                  const trelloUrl = `https://trello.com/b/${b.board_id}`;

                  return (
                    <div
                      key={b.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 transition ${
                        b.is_active
                          ? "border-slate-200 bg-white hover:border-blue-300"
                          : "border-slate-200 bg-slate-50/70 opacity-75"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{b.board_name}</span>
                          <a
                            href={trelloUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                          >
                            <span>{b.board_id}</span>
                            <ArrowSquareOutIcon className="h-3 w-3" />
                          </a>

                          {/* Badge Webhook */}
                          {b.webhook_id ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                              <LightningIcon className="h-3 w-3" weight="fill" />
                              Webhook Realtime
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                              <WarningCircleIcon className="h-3 w-3" weight="fill" />
                              Chưa có Webhook
                            </span>
                          )}

                          {/* Badge Trạng thái Bật/Tắt */}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              b.is_active
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-slate-100 text-slate-500 border border-slate-200"
                            }`}
                          >
                            {b.is_active ? "Đang bật" : "Đã tắt"}
                          </span>
                        </div>

                        {/* Chi tiết cột đích & store mặc định */}
                        <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                          <span>
                            Cột theo dõi:{" "}
                            <strong className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                              {b.target_list_name}
                            </strong>
                          </span>
                          <span>
                            Store mặc định:{" "}
                            <strong className="text-slate-700">
                              {b.default_store_name || "Nhận diện qua nhãn thẻ"}
                            </strong>
                          </span>
                          {b.last_event_at && (
                            <span className="text-slate-400">
                              Kéo thẻ gần nhất: {new Date(b.last_event_at).toLocaleString("vi-VN")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Các nút hành động */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {!b.webhook_id && (
                          <button
                            onClick={() => handleRetryWebhook(b)}
                            disabled={isActionLoading}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
                          >
                            Kích hoạt Webhook
                          </button>
                        )}

                        <button
                          onClick={() => handleSyncNow(b)}
                          disabled={isActionLoading}
                          className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
                          title="Đồng bộ toàn bộ thẻ hiện có trong cột vào Bảng Mã"
                        >
                          <ArrowClockwiseIcon className={`h-3.5 w-3.5 ${isActionLoading ? "animate-spin" : ""}`} />
                          Đồng bộ ngay
                        </button>

                        <button
                          onClick={() => handleToggleActive(b)}
                          disabled={isActionLoading}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            b.is_active
                              ? "border border-slate-200 text-slate-600 hover:bg-slate-100"
                              : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          {b.is_active ? "Tắt" : "Bật"}
                        </button>

                        <button
                          onClick={() => handleDeleteBoard(b)}
                          disabled={isActionLoading}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                          title="Xóa cấu hình"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form thêm board mới */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <PlusIcon className="h-3.5 w-3.5 text-blue-600" weight="bold" />
              Thêm bảng Trello
            </h3>

            <form onSubmit={handleAddBoard} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Link hoặc ID bảng <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newUrlOrId}
                    onChange={(e) => setNewUrlOrId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Store mặc định
                  </label>
                  <select
                    value={newDefaultStoreId}
                    onChange={(e) => setNewDefaultStoreId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tự nhận qua nhãn</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cột theo dõi</label>
                  <input
                    type="text"
                    value={newTargetListName}
                    onChange={(e) => setNewTargetListName(e.target.value)}
                    placeholder="ĐI HÀNG FBA"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !newUrlOrId.trim()}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition disabled:opacity-50"
                >
                  <LightningIcon className="h-4 w-4" weight="fill" />
                  {isSubmitting ? "Đang kết nối..." : "Kết nối bảng"}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-100 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

