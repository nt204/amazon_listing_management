"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  BookmarkSimple,
  CaretDown,
  CaretRight,
  CircleNotch,
  PaperPlaneRight,
  Sparkle,
  StopCircle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { readNdjsonStream } from "@/lib/read-ndjson-stream";
import { SKU_CHAT_GOALS, type SkuChatGoal } from "@/lib/ppc/sku-ai-chat-skill";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

interface SkuNote {
  id: number;
  kind: "FACT" | "DECISION" | "PLAN";
  note: string;
  createdBy: string;
  createdAt: string;
}

type ChatEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "delta"; text: string }
  | { type: "notes"; notes: SkuNote[] }
  | { type: "answer"; text: string; toolsUsed: string[]; model: string }
  | { type: "error"; error: string };

interface PpcSkuAiChatPanelProps {
  storeId: string;
  sku: string;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  "Nhận xét tổng quan SKU này và cho kế hoạch hành động",
  "Campaign / phôi nào đang đốt tiền nhiều nhất?",
  "Search term nào nên phủ định, term nào nên harvest sang Exact?",
  "Có nên scale SKU này không? Nếu có thì scale ở đâu?",
  "Vì sao ACOS đang cao hơn hòa vốn?",
];

const NOTE_KIND: Record<SkuNote["kind"], { label: string; className: string }> = {
  FACT: { label: "Bối cảnh", className: "bg-slate-100 text-slate-600" },
  DECISION: { label: "Quyết định", className: "bg-emerald-50 text-emerald-700" },
  PLAN: { label: "Kế hoạch", className: "bg-amber-50 text-amber-700" },
};

const GOAL_STORAGE_KEY = "ppc-sku-ai-chat:goal";

function loadGoal(): SkuChatGoal {
  try {
    const saved = localStorage.getItem(GOAL_STORAGE_KEY);
    if (saved && SKU_CHAT_GOALS.some((g) => g.value === saved)) return saved as SkuChatGoal;
  } catch {
    // localStorage có thể bị chặn: dùng mục tiêu mặc định.
  }
  return "BALANCED";
}

function chatUrl(storeId: string, sku: string, extra = "") {
  return `/api/ppc/sku-ai-chat?storeId=${encodeURIComponent(storeId)}&sku=${encodeURIComponent(sku)}${extra}`;
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, idx) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={idx} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
      : <span key={idx}>{part}</span>,
  );
}

/** Markdown tối giản (tiêu đề, danh sách, in đậm) đủ cho câu trả lời của AI. */
function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, idx) => <li key={idx}>{renderInline(item)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="list-decimal pl-5 space-y-1">{items}</ol>
      : <ul key={blocks.length} className="list-disc pl-5 space-y-1">{items}</ul>);
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push(
        <h4 key={blocks.length} className="text-[11px] font-black uppercase tracking-wider text-indigo-700 pt-1">
          {renderInline(heading[1])}
        </h4>,
      );
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ||= { ordered, items: [] };
      list.items.push((bullet || numbered)![1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

export function PpcSkuAiChatPanel({ storeId, sku, onClose }: PpcSkuAiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notes, setNotes] = useState<SkuNote[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [goal, setGoal] = useState<SkuChatGoal>(loadGoal);
  const [input, setInput] = useState("");
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  // Chữ AI đang viết (stream); thành tin nhắn khi có "answer".
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Hội thoại và ghi nhớ lưu trên server; mỗi SKU một luồng.
  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    fetch(chatUrl(storeId, sku))
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.success) throw new Error(data?.error || "Không tải được lịch sử chat.");
        setMessages(data.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })));
        setNotes(data.notes);
      })
      .catch((err) => {
        if (!cancelled) setMessages([{ role: "assistant", content: err instanceof Error ? err.message : "Lỗi tải lịch sử.", isError: true }]);
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, sku]);

  useEffect(() => {
    try {
      localStorage.setItem(GOAL_STORAGE_KEY, goal);
    } catch {
      // bỏ qua: chỉ là tiện ích nhớ mục tiêu.
    }
  }, [goal]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, progress, draft]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isLoading) return;
    setMessages((m) => [...m.filter((msg) => !msg.isError), { role: "user", content }]);
    setInput("");
    setIsLoading(true);
    setProgress([]);
    setDraft("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ppc/sku-ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, sku, goal, message: content }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Lỗi ${res.status}`);
      }
      let answered = false;
      await readNdjsonStream<ChatEvent>(res, (event) => {
        if (event.type === "status") setProgress((p) => [...p, event.text]);
        else if (event.type === "delta") setDraft((d) => d + event.text);
        else if (event.type === "tool") {
          // AI đổi ý đi tra thêm dữ liệu: bỏ phần chữ đang viết dở.
          setDraft("");
          setProgress((p) => [...p, `${event.label}…`]);
        }
        else if (event.type === "notes") {
          setNotes(event.notes);
          setShowNotes(true);
        } else if (event.type === "answer") {
          answered = true;
          setDraft("");
          setMessages((m) => [...m, { role: "assistant", content: event.text }]);
        } else if (event.type === "error") {
          answered = true;
          setMessages((m) => [...m, { role: "assistant", content: event.error, isError: true }]);
        }
      });
      if (!answered) throw new Error("Kết nối bị ngắt trước khi AI trả lời.");
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((m) => [...m, {
        role: "assistant",
        content: err instanceof Error ? err.message : "Lỗi kết nối AI.",
        isError: true,
      }]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
        setProgress([]);
        setDraft("");
      }
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setProgress([]);
  };

  const reset = async () => {
    if (!confirm("Xóa cuộc trò chuyện này? (Ghi nhớ của SKU vẫn giữ)")) return;
    stop();
    const res = await fetch(chatUrl(storeId, sku), { method: "DELETE" }).catch(() => null);
    if (res?.ok) setMessages([]);
  };

  const removeNote = async (noteId: number) => {
    const res = await fetch(chatUrl(storeId, sku, `&noteId=${noteId}`), { method: "DELETE" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.success) setNotes(data.notes);
  };

  return (
    <aside
      className="w-full lg:w-[440px] shrink-0 max-h-[92vh] h-[92vh] bg-white border border-slate-200 rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right-4 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-violet-50">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Sparkle size={16} weight="fill" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900">AI cố vấn SKU</h3>
            <p className="text-[11px] text-slate-500 font-mono truncate">{sku}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={reset}
              title="Xóa cuộc trò chuyện"
              className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <ArrowClockwise size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            title="Đóng"
            className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-slate-100 space-y-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Mục tiêu tối ưu</p>
          <div className="flex flex-wrap gap-1.5">
            {SKU_CHAT_GOALS.map((g) => (
              <button
                key={g.value}
                onClick={() => setGoal(g.value)}
                title={g.hint}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer transition-colors ${
                  goal === g.value
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            {showNotes ? <CaretDown size={10} /> : <CaretRight size={10} />}
            <BookmarkSimple size={11} weight="fill" />
            AI ghi nhớ ({notes.length})
          </button>
          {showNotes && (
            <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto">
              {notes.length === 0 && (
                <p className="text-[11px] text-slate-400">
                  Chưa có. Nói với AI các kế hoạch / quyết định (vd. &quot;SKU này đẩy rank tới 15/11&quot;), AI sẽ nhớ cho cả team.
                </p>
              )}
              {notes.map((n) => (
                <div key={n.id} className="group flex items-start gap-1.5 text-[11px] text-slate-600">
                  <span className={`shrink-0 px-1.5 py-0.5 rounded font-bold ${NOTE_KIND[n.kind].className}`}>
                    {NOTE_KIND[n.kind].label}
                  </span>
                  <span className="flex-1">
                    {n.note}
                    <span className="text-slate-400"> · {n.createdAt.slice(0, 10)} · {n.createdBy}</span>
                  </span>
                  <button
                    onClick={() => removeNote(n.id)}
                    title="Xóa ghi nhớ"
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[13px] leading-relaxed text-slate-700">
        {isHistoryLoading && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <CircleNotch size={12} className="animate-spin" /> Đang tải lịch sử…
          </div>
        )}

        {!isHistoryLoading && messages.length === 0 && !isLoading && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              AI đọc số kế toán, PPC 30 ngày, phôi campaign, search term, đề xuất bid, lịch sử chỉnh bid, tồn kho và ghi nhớ của SKU này.
              Hỏi bất cứ điều gì, hoặc bắt đầu bằng:
            </p>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                className="w-full text-left px-3 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-indigo-600 text-white whitespace-pre-wrap"
                  : m.isError
                  ? "max-w-[95%] px-3 py-2 rounded-2xl rounded-bl-md bg-red-50 border border-red-200 text-red-700"
                  : "max-w-[95%] px-3 py-2 rounded-2xl rounded-bl-md bg-slate-50 border border-slate-200"
              }
            >
              {m.role === "assistant" && !m.isError ? <MarkdownLite text={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {isLoading && draft && (
          <div className="flex justify-start">
            <div className="max-w-[95%] px-3 py-2 rounded-2xl rounded-bl-md bg-slate-50 border border-slate-200">
              <MarkdownLite text={draft} />
            </div>
          </div>
        )}

        {isLoading && !draft && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-1">
              {(progress.length ? progress : ["Đang kết nối…"]).map((step, idx, arr) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {idx === arr.length - 1
                    ? <CircleNotch size={12} className="animate-spin text-indigo-600" />
                    : <span className="w-3 text-center text-emerald-600">✓</span>}
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-100">
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
            placeholder="Hỏi AI về SKU này… (Enter để gửi)"
            className="flex-1 resize-none px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
          />
          {isLoading ? (
            <button
              onClick={stop}
              title="Dừng"
              className="p-2.5 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || isHistoryLoading}
              title="Gửi"
              className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">
          AI chỉ gợi ý. Mọi thay đổi bid vẫn duyệt ở danh sách đề xuất / Action Queue.
        </p>
      </div>
    </aside>
  );
}
