"use client";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  FileCsvIcon,
  GearIcon,
  ImageSquareIcon,
  LightningIcon,
  ListNumbersIcon,
  MapPinIcon,
  PathIcon,
  SparkleIcon,
  SpinnerIcon,
  TagIcon,
  KanbanIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { BrandProfile, StoredListing } from "@/lib/types";
import { extractTrelloBoardId } from "@/lib/trello";

interface TrelloWorkspaceProps {
  open: boolean;
  brands: BrandProfile[];
  onClose: () => void;
  onListingCreated?: (listing: StoredListing) => void;
}

interface TrelloBoard {
  id: string;
  name: string;
  url: string;
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  attachments?: TrelloAttachment[];
  parsed?: {
    sku: string;
    itemName: string;
  };
}

export function TrelloWorkspace({ open, brands, onClose, onListingCreated }: TrelloWorkspaceProps) {
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [boardId, setBoardId] = useState("");
  const [reviewListName, setReviewListName] = useState("TEAM DUYỆT NỘI BỘ");
  const [listingListName, setListingListName] = useState("Listing");
  const [brandProfileId, setBrandProfileId] = useState("");

  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [reviewList, setReviewList] = useState<TrelloList | null>(null);
  const [listingList, setListingList] = useState<TrelloList | null>(null);

  const [reviewCards, setReviewCards] = useState<TrelloCard[]>([]);
  const [listingCards, setListingCards] = useState<TrelloCard[]>([]);

  const [loading, setLoading] = useState(false);
  const [processingCardId, setProcessingCardId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  // Load config on mount or open
  useEffect(() => {
    if (!open) return;
    fetchConfig();
  }, [open]);

  const saveLocalConfig = (key: string, tok: string, bId: string, rName: string, lName: string) => {
    try {
      const cleanId = extractTrelloBoardId(bId);
      if (typeof window !== "undefined") {
        if (key) localStorage.setItem("trello_api_key", key);
        if (tok) localStorage.setItem("trello_token", tok);
        if (cleanId) localStorage.setItem("trello_board_id", cleanId);
        if (rName) localStorage.setItem("trello_review_list_name", rName);
        if (lName) localStorage.setItem("trello_listing_list_name", lName);
      }
    } catch (e) {
      console.error("Failed to save to localStorage", e);
    }
  };

  const fetchConfig = async () => {
    try {
      setError("");
      const localApiKey = typeof window !== "undefined" ? localStorage.getItem("trello_api_key") : null;
      const localToken = typeof window !== "undefined" ? localStorage.getItem("trello_token") : null;
      const localBoardId = typeof window !== "undefined" ? localStorage.getItem("trello_board_id") : null;
      const localReviewName = typeof window !== "undefined" ? localStorage.getItem("trello_review_list_name") : null;
      const localListingName = typeof window !== "undefined" ? localStorage.getItem("trello_listing_list_name") : null;

      const res = await fetch("/api/trello/config");
      const data = await res.json();
      if (res.ok) {
        const finalApiKey = localApiKey || data.rawApiKey || "";
        const finalToken = localToken || data.rawToken || "";
        const rawBoardId = localBoardId || data.boardId || "";
        const finalBoardId = extractTrelloBoardId(rawBoardId);
        const finalReviewName = localReviewName || data.internalReviewListName || "TEAM DUYỆT NỘI BỘ";
        const finalListingName = localListingName || data.listingListName || "Listing";

        if (finalApiKey) setApiKey(finalApiKey);
        if (finalToken) setToken(finalToken);
        if (finalBoardId) setBoardId(finalBoardId);
        if (finalReviewName) setReviewListName(finalReviewName);
        if (finalListingName) setListingListName(finalListingName);

        if (finalApiKey && finalToken && finalBoardId) {
          loadCards(finalApiKey, finalToken, finalBoardId, finalReviewName, finalListingName);
        } else {
          setShowConfig(true);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadCards = useCallback(
    async (key = apiKey, tok = token, bId = boardId, rName = reviewListName, lName = listingListName) => {
      const cleanId = extractTrelloBoardId(bId);
      if (!key || !tok || !cleanId) {
        setShowConfig(true);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({
          apiKey: key,
          token: tok,
          boardId: cleanId,
          internalReviewListName: rName,
          listingListName: lName,
        });
        const res = await fetch(`/api/trello/cards?${query.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Không thể tải thẻ Trello.");
        }
        setLists(data.lists || []);
        setReviewList(data.internalReviewList);
        setListingList(data.listingList);
        setReviewCards(data.reviewCards || []);
        setListingCards(data.listingCards || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải Trello.");
      } finally {
        setLoading(false);
      }
    },
    [apiKey, token, boardId, reviewListName, listingListName],
  );

  const testAndFetchBoards = async () => {
    if (!apiKey || !token) {
      setError("Vui lòng nhập API Key và Token Trello.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cleanId = extractTrelloBoardId(boardId);
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, token, boardId: cleanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể kết nối Trello.");
      setBoards(data.boards || []);
      if (data.lists) setLists(data.lists);
      setSuccessMsg("Kết nối Trello thành công!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi kết nối Trello.");
    } finally {
      setLoading(false);
    }
  };

  const processCardToListing = async (card: TrelloCard) => {
    setProcessingCardId(card.id);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/trello/process-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: card.id,
          targetListId: listingList?.id,
          apiKey,
          token,
          brandProfileId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tạo Listing.");

      setSuccessMsg(`Tạo Listing thành công cho SKU: ${data.sku}! Đã đính kèm file CSV vào thẻ Trello.`);

      if (data.listing && onListingCreated) {
        onListingCreated(data.listing);
      }

      // Refresh cards list
      await loadCards();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo Listing từ thẻ Trello.");
    } finally {
      setProcessingCardId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <KanbanIcon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Tích Hợp Trello Auto-Listing</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tự động lấy SKU, ảnh mockup & keywords từ thẻ Trello, tạo Listing & đính kèm file bên dưới
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {brands.length > 0 && (
              <select
                value={brandProfileId}
                onChange={(e) => setBrandProfileId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="">Thương hiệu mặc định (Limima)</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setShowConfig(!showConfig)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <GearIcon className="h-4 w-4" />
              Cấu Hình Trello
            </button>

            <button
              onClick={() => loadCards()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : "Làm Mới"}
            </button>

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Notifications */}
        {error && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <WarningCircleIcon className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircleIcon className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Cấu hình Trello */}
        {showConfig && (
          <div className="border-b border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Cấu hình kết nối Trello API</h3>
              <p className="text-xs text-slate-500">Lấy API Key tại: https://trello.com/app-key</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Trello API Key
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Nhập Trello API Key..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Trello Token
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Nhập Trello User Token..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Board ID / URL Trello Board</label>
                {boards.length > 0 ? (
                  <select
                    value={boardId}
                    onChange={(e) => setBoardId(extractTrelloBoardId(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">-- Chọn Board --</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={boardId}
                    onChange={(e) => setBoardId(extractTrelloBoardId(e.target.value))}
                    placeholder="https://trello.com/b/UaCRcUxZ/test-project hoặc UaCRcUxZ"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tên Cột Nội Bộ Duyệt (Nguồn)
                </label>
                <input
                  type="text"
                  value={reviewListName}
                  onChange={(e) => setReviewListName(e.target.value)}
                  placeholder="TEAM DUYỆT NỘI BỘ"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tên Cột Listing (Đích)
                </label>
                <input
                  type="text"
                  value={listingListName}
                  onChange={(e) => setListingListName(e.target.value)}
                  placeholder="Listing"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={testAndFetchBoards}
                disabled={loading}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                Kiểm Tra & Lấy Danh Sách Board
              </button>
              <button
                onClick={() => {
                  saveLocalConfig(apiKey, token, boardId, reviewListName, listingListName);
                  loadCards(apiKey, token, boardId, reviewListName, listingListName);
                  setShowConfig(false);
                }}
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Lưu & Áp Dụng Cấu Hình
              </button>
            </div>
          </div>
        )}

        {/* Body Kanban */}
        <div className="flex flex-1 overflow-x-auto overflow-y-hidden p-6 gap-6 bg-slate-100 dark:bg-slate-950">
          {/* Column 1: TEAM DUYỆT NỘI BỘ */}
          <div className="flex w-1/2 flex-col rounded-xl bg-slate-200/70 p-4 dark:bg-slate-900/60">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-amber-500"></span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {reviewList ? reviewList.name : reviewListName}
                </h3>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
                  {reviewCards.length}
                </span>
              </div>
              <span className="text-xs text-slate-500">Sẵn sàng tạo Listing</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {reviewCards.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
                  <p className="text-xs text-slate-500">Không có thẻ nào trong danh sách duyệt nội bộ</p>
                </div>
              ) : (
                reviewCards.map((card) => {
                  const isProcessing = processingCardId === card.id;
                  const imageCount = (card.attachments || []).filter(
                    (a) => a.mimeType?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(a.url),
                  ).length;

                  return (
                    <div
                      key={card.id}
                      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <span className="inline-block rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                            SKU: {card.parsed?.sku || "N/A"}
                          </span>
                          <h4 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
                            {card.parsed?.itemName || card.name}
                          </h4>
                        </div>
                      </div>

                      {card.desc && (
                        <p className="mb-3 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                          {card.desc}
                        </p>
                      )}

                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700/50">
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <ImageSquareIcon className="h-3.5 w-3.5 text-slate-400" />
                            {imageCount} ảnh mockup
                          </span>
                        </div>

                        <button
                          onClick={() => processCardToListing(card)}
                          disabled={isProcessing || loading}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {isProcessing ? (
                            <>
                              <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                              <span>Đang tạo...</span>
                            </>
                          ) : (
                            <>
                              <LightningIcon className="h-3.5 w-3.5 fill-current" />
                              <span>Tạo Listing & Đính Kèm</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: LISTING */}
          <div className="flex w-1/2 flex-col rounded-xl bg-slate-200/70 p-4 dark:bg-slate-900/60">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500"></span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {listingList ? listingList.name : listingListName}
                </h3>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  {listingCards.length}
                </span>
              </div>
              <span className="text-xs text-slate-500">Đã đính kèm file Listing</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {listingCards.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
                  <p className="text-xs text-slate-500">Chưa có thẻ nào trong cột Listing</p>
                </div>
              ) : (
                listingCards.map((card) => {
                  const csvAttachment = (card.attachments || []).find(
                    (a) => a.name.endsWith(".csv") || a.mimeType === "text/csv",
                  );

                  return (
                    <div
                      key={card.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <span className="inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                            SKU: {card.parsed?.sku || "N/A"}
                          </span>
                          <h4 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
                            {card.parsed?.itemName || card.name}
                          </h4>
                        </div>
                      </div>

                      {csvAttachment && (
                        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                          <FileCsvIcon className="h-5 w-5 text-emerald-600" />
                          <span className="flex-1 truncate">{csvAttachment.name}</span>
                          <a
                            href={csvAttachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
                          >
                            Tải Về
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
