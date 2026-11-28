"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ChatCircleTextIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  SparkleIcon,
  StopCircleIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { readNdjsonStream } from "@/lib/read-ndjson-stream";
import { MarkdownLite } from "@/components/agents/markdown-lite";

// Panel chat dùng chung cho mọi agent đăng ký ở lib/agents/registry.ts (POST /api/agents/<agent>).
// Ghim bên phải, KHÔNG che màn hình: vừa xem số vừa hỏi; bấm "?" ở số khác thì câu hỏi xếp hàng vào cuộc chat đang mở.
// Màn hình truyền `context` (chỉ số, store, kỳ… đang xem) để agent biết người dùng đang hỏi về số nào.

type AgentStreamEvent =
  | { type: "run"; runId: string; contextLabel?: string | null }
  | { type: "status"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "delta"; text: string }
  | { type: "answer"; runId: string; text: string; toolsUsed: string[]; model: string; followUps?: string[] }
  | { type: "error"; runId?: string; error: string };

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  runId?: string;
  feedback?: 1 | -1;
  /** Lượt đang chạy trên server (vd đã đóng khung chat khi AI đang trả lời). */
  pending?: boolean;
  /** Câu hỏi: hỏi trong bối cảnh nào ("Profit · 01/11–18/11 · Tất cả store"). */
  contextLabel?: string | null;
  /** Câu trả lời: gợi ý câu hỏi tiếp theo. */
  followUps?: string[];
}

/** Một lượt hỏi–đáp đã lưu (GET /api/agents/<agent>). */
interface SessionMessage {
  runId: string;
  userMessage: string;
  answer: string | null;
  status: "running" | "done" | "error";
  error: string | null;
  feedback: 1 | -1 | null;
  contextLabel: string | null;
  followUps: string[];
}

function toChatMessages(rows: SessionMessage[]): ChatMessage[] {
  return rows.flatMap((r): ChatMessage[] => [
    { role: "user", content: r.userMessage, contextLabel: r.contextLabel },
    r.status === "done" && r.answer
      ? { role: "assistant", content: r.answer, runId: r.runId, feedback: r.feedback ?? undefined, followUps: r.followUps }
      : r.status === "running"
        ? { role: "assistant", content: "", runId: r.runId, pending: true }
        : { role: "assistant", content: r.error || "Lượt trả lời bị lỗi.", isError: true },
  ]);
}

/** Một cuộc chat trong lịch sử (GET /api/agents/<agent>?list=1). */
interface SessionSummary {
  sessionId: string;
  title: string;
  turns: number;
  lastAt: string;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `Hôm nay ${time}`
    : `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${time}`;
}

type ScreenContext = Record<string, unknown>;

/** Câu hỏi gửi từ màn hình (vd bấm "?" cạnh một con số). `id` đổi = câu hỏi mới. */
export interface AgentChatRequest {
  id: number;
  question: string;
  context?: ScreenContext | null;
}

export interface AgentChatPanelProps {
  agent: string;
  title: string;
  /** Bối cảnh màn hình gửi kèm câu hỏi người dùng tự gõ. */
  context?: ScreenContext | null;
  /** Nhãn ngắn của bối cảnh hiện tại (kỳ, store…), hiện dưới tiêu đề. */
  contextChips?: string[];
  suggestions?: string[];
  /** Câu hỏi từ màn hình — nối vào cuộc chat đang mở, xếp hàng nếu AI đang bận. */
  request?: AgentChatRequest | null;
  /** Khối riêng của agent hiện dưới tiêu đề (vd dải cảnh báo dữ liệu của AI đối soát). */
  banner?: ReactNode;
  footnote?: string;
  onClose: () => void;
  /** "docked" = ghim cạnh phải cao hết màn hình (mặc định); "floating" = cửa sổ nhỏ góc dưới phải. */
  variant?: "docked" | "floating";
  /** Ẩn tạm (vẫn giữ trạng thái), vd khi đang chạy hướng dẫn trên màn hình. */
  hidden?: boolean;
  placeholder?: string;
  /** Lời chào khi cuộc chat còn trống (hiện trên các câu gợi ý). */
  welcome?: ReactNode;
  /** Đổi chữ câu trả lời trước khi hiển thị (vd bỏ mã [[tour:…]]). */
  formatAnswer?: (text: string) => string;
  /** Khối riêng dưới câu trả lời (vd nút "Xem mình làm"). */
  renderAnswerExtras?: (text: string) => ReactNode;
}

const newSessionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const headerButton =
  "flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white hover:text-indigo-700 disabled:cursor-default disabled:opacity-40";

export function AgentChatPanel({
  agent,
  title,
  context,
  contextChips,
  suggestions = [],
  request,
  banner,
  footnote,
  onClose,
  variant = "docked",
  hidden = false,
  placeholder = "Hỏi về con số… (Enter để gửi)",
  welcome,
  formatAnswer = (text: string) => text,
  renderAnswerExtras,
}: AgentChatPanelProps) {
  const apiUrl = `/api/agents/${encodeURIComponent(agent)}`;
  // Lịch sử chat lưu trên server (bảng agent_runs) theo TỪNG TÀI KHOẢN: đóng / mở panel, F5, đổi máy vẫn còn.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [queue, setQueue] = useState<{ question: string; context?: ScreenContext | null }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRequestRef = useRef<number | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, progress, draft, queue]);

  // Không hủy request khi đóng panel: server vẫn trả lời xong và lưu lại, mở lại là thấy.
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessionId: string | null; messages: SessionMessage[] } | null) => {
        if (cancelled) return;
        setSessionId(data?.sessionId ?? newSessionId());
        setMessages(toChatMessages(data?.messages ?? []));
      })
      .catch(() => {
        if (!cancelled) setSessionId(newSessionId());
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  // Có lượt đang chạy trên server (đóng panel lúc AI đang trả lời): hỏi lại mỗi 3 giây tới khi xong.
  const hasPending = messages.some((m) => m.pending);
  useEffect(() => {
    if (!hasPending || !sessionId || isLoading) return;
    const timer = setInterval(async () => {
      const data = await fetch(`${apiUrl}?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (data?.messages) setMessages(toChatMessages(data.messages));
    }, 3000);
    return () => clearInterval(timer);
  }, [apiUrl, hasPending, sessionId, isLoading]);

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, hidden]);

  const busy = isLoading || hasPending || historyLoading || !sessionId;

  const send = async (text: string, askContext?: ScreenContext | null) => {
    const content = text.trim();
    if (!content || busy) return;
    const ctx = askContext === undefined ? context : askContext;
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    setIsLoading(true);
    setProgress([]);
    setDraft("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, sessionId, ...(ctx ? { context: ctx } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Lỗi ${res.status}`);
      }
      let answered = false;
      await readNdjsonStream<AgentStreamEvent>(res, (event) => {
        if (event.type === "run") {
          // Gắn nhãn bối cảnh (do server tính) vào câu hỏi vừa gửi
          setMessages((m) => {
            const i = m.length - 1;
            return i >= 0 && m[i].role === "user" ? [...m.slice(0, i), { ...m[i], contextLabel: event.contextLabel }] : m;
          });
        } else if (event.type === "status") setProgress((p) => (p[p.length - 1] === event.text ? p : [...p, event.text]));
        else if (event.type === "delta") setDraft((d) => d + event.text);
        else if (event.type === "tool") {
          // AI đi tra thêm dữ liệu: bỏ phần chữ đang viết dở.
          setDraft("");
          setProgress((p) => [...p, `${event.label}…`]);
        } else if (event.type === "answer") {
          answered = true;
          setDraft("");
          setMessages((m) => [...m, { role: "assistant", content: event.text, runId: event.runId, followUps: event.followUps }]);
        } else if (event.type === "error") {
          answered = true;
          setMessages((m) => [...m, { role: "assistant", content: event.error, isError: true }]);
        }
      });
      if (!answered) throw new Error("Kết nối bị ngắt trước khi AI trả lời.");
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((m) => [
        ...m,
        { role: "assistant", content: err instanceof Error ? err.message : "Lỗi kết nối AI.", isError: true },
      ]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
        setProgress([]);
        setDraft("");
      }
    }
  };

  // Câu hỏi từ màn hình: chỉ xếp hàng (mỗi id 1 lần — StrictMode chạy effect 2 lần), gửi ở effect dưới khi rảnh.
  useEffect(() => {
    if (!request || lastRequestRef.current === request.id) return;
    lastRequestRef.current = request.id;
    setView("chat");
    setQueue((q) => [...q, { question: request.question, context: request.context }]);
  }, [request]);

  useEffect(() => {
    if (busy || view !== "chat" || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void send(next.question, next.context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, view, queue]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setProgress([]);
    setDraft("");
  };

  const newConversation = () => {
    setSessionId(newSessionId());
    setMessages([]);
    setView("chat");
  };

  const openHistory = async () => {
    setView("history");
    setSessions(null);
    const data = await fetch(`${apiUrl}?list=1`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    setSessions(data?.sessions ?? []);
  };

  const openSession = async (id: string) => {
    setView("chat");
    if (id === sessionId) return;
    setHistoryLoading(true);
    setMessages([]);
    const data = await fetch(`${apiUrl}?sessionId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    setSessionId(id);
    setMessages(toChatMessages(data?.messages ?? []));
    setHistoryLoading(false);
  };

  const deleteSession = async (id: string) => {
    if (!confirm("Xóa cuộc chat này khỏi lịch sử?")) return;
    const res = await fetch(`${apiUrl}?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return;
    setSessions((list) => list?.filter((x) => x.sessionId !== id) ?? null);
    if (id === sessionId) {
      setSessionId(newSessionId());
      setMessages([]);
    }
  };

  const rate = async (index: number, feedback: 1 | -1) => {
    const msg = messages[index];
    if (!msg?.runId || msg.feedback === feedback) return;
    setMessages((m) => m.map((x, i) => (i === index ? { ...x, feedback } : x)));
    const res = await fetch(apiUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: msg.runId, feedback }),
    }).catch(() => null);
    if (!res?.ok) setMessages((m) => m.map((x, i) => (i === index ? { ...x, feedback: undefined } : x)));
  };

  const lastAnswerIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return i;
    return -1;
  })();

  return (
    <aside
      role="complementary"
      aria-label={title}
      hidden={hidden}
      className={
        variant === "floating"
          ? "fixed bottom-20 right-4 z-[60] flex h-[min(640px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-150"
          : "fixed bottom-2 right-2 top-2 z-[60] flex w-[min(480px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in slide-in-from-right-4 duration-150"
      }
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <SparkleIcon size={16} weight="fill" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900">{title}</h3>
            {contextChips && contextChips.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="text-[10.5px] text-slate-400">Đang xem</span>
                {contextChips.map((chip) => (
                  <span key={chip} className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10.5px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {view === "chat" ? (
            <>
              <button
                onClick={openHistory}
                disabled={isLoading}
                title={isLoading ? "Đợi AI trả lời xong" : "Lịch sử chat của bạn"}
                className={headerButton}
              >
                <ClockCounterClockwiseIcon size={14} />
                Lịch sử
              </button>
              {messages.length > 0 && (
                <button
                  onClick={newConversation}
                  disabled={isLoading}
                  title={isLoading ? "Đợi AI trả lời xong" : "Bắt đầu cuộc chat mới (cuộc này vẫn ở Lịch sử)"}
                  className={headerButton}
                >
                  <PlusIcon size={14} />
                  Mới
                </button>
              )}
            </>
          ) : (
            <button onClick={() => setView("chat")} className={headerButton}>
              <ArrowLeftIcon size={14} />
              Quay lại
            </button>
          )}
          <button onClick={onClose} title="Đóng (Esc)" className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600">
            <XIcon size={18} />
          </button>
        </div>
      </div>

      {view === "history" ? (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <button
            onClick={newConversation}
            className="mb-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
          >
            <PlusIcon size={14} weight="bold" />
            Cuộc chat mới
          </button>
          {sessions === null && (
            <div className="flex items-center gap-1.5 px-1 text-xs text-slate-400">
              <CircleNotchIcon size={12} className="animate-spin" /> Đang tải lịch sử…
            </div>
          )}
          {sessions?.length === 0 && <p className="px-1 text-xs text-slate-400">Chưa có cuộc chat nào.</p>}
          <ul className="space-y-1">
            {sessions?.map((item) => (
              <li key={item.sessionId} className="group flex items-start gap-1">
                <button
                  onClick={() => openSession(item.sessionId)}
                  className={`flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-slate-50 ${
                    item.sessionId === sessionId ? "bg-indigo-50 ring-1 ring-indigo-100" : ""
                  }`}
                >
                  <ChatCircleTextIcon size={15} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[12.5px] font-semibold text-slate-800">{item.title || "(không có nội dung)"}</span>
                    <span className="text-[10.5px] text-slate-400">
                      {formatWhen(item.lastAt)} · {item.turns} câu hỏi
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => deleteSession(item.sessionId)}
                  title="Xóa cuộc chat này"
                  aria-label="Xóa cuộc chat này"
                  className="mt-1.5 shrink-0 cursor-pointer rounded-lg p-1.5 text-slate-300 opacity-60 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {banner}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed text-slate-700">
            {historyLoading && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <CircleNotchIcon size={12} className="animate-spin" /> Đang tải hội thoại…
              </div>
            )}

            {!historyLoading && messages.length === 0 && !isLoading && !queue.length && (welcome || suggestions.length > 0) && (
              <div className="space-y-2">
                {welcome}
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={idx} className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}>
                {m.role === "user" && m.contextLabel && (
                  <span className="mb-0.5 pr-1 text-[10px] font-semibold text-slate-400">{m.contextLabel}</span>
                )}
                {m.pending ? (
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <CircleNotchIcon size={12} className="animate-spin text-indigo-600" />
                    AI đang trả lời câu này…
                  </div>
                ) : (
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-3 py-2 text-white"
                        : m.isError
                          ? "max-w-[95%] rounded-2xl rounded-bl-md border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                          : "max-w-[95%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3 py-2"
                    }
                  >
                    {m.role === "assistant" && !m.isError ? <MarkdownLite text={formatAnswer(m.content)} /> : m.content}
                  </div>
                )}
                {m.role === "assistant" && !m.isError && !m.pending && renderAnswerExtras?.(m.content)}
                {m.role === "assistant" && m.runId && !m.pending && (
                  <div className="mt-1 flex items-center gap-1 pl-1 text-slate-400">
                    <span className="text-[10.5px]">Câu trả lời đúng không?</span>
                    <button
                      onClick={() => rate(idx, 1)}
                      title="Đúng / hữu ích"
                      className={`cursor-pointer rounded p-0.5 hover:text-emerald-600 ${m.feedback === 1 ? "text-emerald-600" : ""}`}
                    >
                      <ThumbsUpIcon size={13} weight={m.feedback === 1 ? "fill" : "regular"} />
                    </button>
                    <button
                      onClick={() => rate(idx, -1)}
                      title="Sai / chưa đúng ý"
                      className={`cursor-pointer rounded p-0.5 hover:text-rose-600 ${m.feedback === -1 ? "text-rose-600" : ""}`}
                    >
                      <ThumbsDownIcon size={13} weight={m.feedback === -1 ? "fill" : "regular"} />
                    </button>
                  </div>
                )}
                {idx === lastAnswerIndex && !busy && !queue.length && m.followUps && m.followUps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.followUps.map((q) => (
                      <button
                        key={q}
                        onClick={() => send(q)}
                        className="cursor-pointer rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && draft && (
              <div className="flex justify-start">
                <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <MarkdownLite text={formatAnswer(draft)} />
                </div>
              </div>
            )}

            {isLoading && !draft && (
              <div className="flex justify-start">
                <div className="space-y-1 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {(progress.length ? progress : ["Đang kết nối…"]).map((step, idx, arr) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      {idx === arr.length - 1 ? (
                        <CircleNotchIcon size={12} className="animate-spin text-indigo-600" />
                      ) : (
                        <span className="w-3 text-center text-emerald-600">✓</span>
                      )}
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {queue.map((q, i) => (
              <div key={`q${i}`} className="flex flex-col items-end">
                <span className="mb-0.5 pr-1 text-[10px] font-semibold text-slate-400">Chờ câu trước trả lời xong</span>
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-indigo-700">
                  {q.question}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder={placeholder}
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              {isLoading ? (
                <button onClick={stop} title="Dừng" className="cursor-pointer rounded-xl bg-slate-100 p-2.5 text-slate-600 hover:bg-slate-200">
                  <StopCircleIcon size={18} />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || busy}
                  title="Gửi"
                  className="cursor-pointer rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PaperPlaneRightIcon size={18} weight="fill" />
                </button>
              )}
            </div>
            {footnote && <p className="mt-1.5 text-[10px] text-slate-400">{footnote}</p>}
          </div>
        </>
      )}
    </aside>
  );
}
