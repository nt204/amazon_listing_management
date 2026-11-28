"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenTextIcon, CaretDownIcon, ChatCircleDotsIcon, HandPointingIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { AgentChatPanel } from "@/components/agents/agent-chat-panel";
import { extractTourIds, stripTourMarkers, type GuideTour } from "@/lib/guide/types";
import type { GuideTourMode } from "@/components/guide/guide-tour-runner";

// Trợ lý hướng dẫn sử dụng (THỬ NGHIỆM): nút chat góc dưới phải → hỏi AI cách dùng màn hình → AI gắn kịch bản
// [[tour:<id>]] → nút "Xem mình làm" chạy hướng dẫn ngay trên màn hình (components/guide/guide-tour-runner.ts).
// Lịch sử chat lưu theo tài khoản (agent_runs) như mọi agent khác.

export interface GuideAssistantProps {
  agent: string;
  title: string;
  tours: GuideTour[];
  /** Bối cảnh màn hình gửi kèm câu hỏi (store, kỳ dữ liệu…). */
  context?: Record<string, unknown> | null;
  contextChips?: string[];
  suggestions?: string[];
}

export function GuideAssistant({ agent, title, tours, context, contextChips, suggestions }: GuideAssistantProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [showTours, setShowTours] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const tourById = useCallback((id: string) => tours.find((t) => t.id === id) ?? null, [tours]);

  // Rời màn hình khi đang chạy hướng dẫn → dừng, trả lại giao diện
  useEffect(() => () => stopRef.current?.(), []);

  const play = useCallback(
    async (tour: GuideTour, mode: GuideTourMode) => {
      if (running) return;
      setRunning(tour.id);
      try {
        const { runGuideTour } = await import("@/components/guide/guide-tour-runner");
        stopRef.current = runGuideTour(tour, {
          mode,
          onEnd: () => {
            stopRef.current = null;
            setRunning(null);
          },
        });
      } catch (error) {
        console.error("[guide] Không chạy được hướng dẫn:", error);
        setRunning(null);
      }
    },
    [running],
  );

  const tourCard = (tour: GuideTour) => (
    <div key={tour.id} className="mt-2 w-full max-w-[95%] rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
      <div className="text-[12px] font-bold text-indigo-900">{tour.title}</div>
      <div className="mt-0.5 text-[11px] text-slate-600">{tour.summary}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={Boolean(running)}
          onClick={() => play(tour, "auto")}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-50"
        >
          <PlayIcon size={12} weight="fill" /> Xem mình làm
        </button>
        <button
          type="button"
          disabled={Boolean(running)}
          onClick={() => play(tour, "manual")}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-50"
        >
          <HandPointingIcon size={12} weight="bold" /> Đi từng bước
        </button>
      </div>
    </div>
  );

  const renderAnswerExtras = (text: string) => {
    const found = extractTourIds(text).map(tourById).filter((t): t is GuideTour => Boolean(t));
    return found.length ? <>{found.map(tourCard)}</> : null;
  };

  const tourChip = (tour: GuideTour, index: number) => (
    <button
      key={tour.id}
      type="button"
      disabled={Boolean(running)}
      onClick={() => {
        setShowTours(false);
        void play(tour, "auto");
      }}
      title={tour.summary}
      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
    >
      <span className="text-[10px] font-black text-indigo-400">{index + 1}</span> {tour.title}
    </button>
  );

  // Danh sách hướng dẫn luôn mở được (kể cả khi đã có hội thoại), xếp theo quy trình tới đầu ra
  const toursBar = (
    <div className="border-b border-slate-100 px-4 py-2">
      <button
        type="button"
        onClick={() => setShowTours((v) => !v)}
        aria-expanded={showTours}
        className="flex w-full cursor-pointer items-center gap-1.5 text-[11.5px] font-bold text-indigo-700"
      >
        <BookOpenTextIcon size={14} weight="bold" />
        Tất cả hướng dẫn ({tours.length}) — theo thứ tự quy trình
        <CaretDownIcon size={12} weight="bold" className={`ml-auto transition-transform ${showTours ? "rotate-180" : ""}`} />
      </button>
      {showTours && <div className="mt-2 flex flex-wrap gap-1.5 pb-1">{tours.map(tourChip)}</div>}
    </div>
  );

  const welcome = (
    <div className="space-y-2 pb-1">
      <p className="text-[12.5px] text-slate-600">
        Chào bạn 👋 Mình hướng dẫn màn <b>Đề xuất &amp; Auto Bid</b> từ lọc SKU → duyệt → Action Queue → <b>xuất file Bulk
        hoặc Auto Upload</b> lên Amazon. Hỏi bất cứ điều gì, hoặc chọn một hướng dẫn để mình làm mẫu ngay trên màn hình:
      </p>
      <div className="flex flex-wrap gap-1.5">{tours.map(tourChip)}</div>
      {suggestions?.length ? <p className="pt-1 text-[11px] font-semibold text-slate-400">Hoặc hỏi thử:</p> : null}
    </div>
  );

  return (
    <>
      {open && (
        <AgentChatPanel
          agent={agent}
          title={title}
          variant="floating"
          hidden={Boolean(running)}
          context={context}
          contextChips={contextChips}
          suggestions={suggestions}
          welcome={welcome}
          banner={toursBar}
          placeholder="Hỏi cách dùng… vd: làm sao giảm bid cho 1 SKU? (Enter để gửi)"
          formatAnswer={stripTourMarkers}
          renderAnswerExtras={renderAnswerExtras}
          footnote="Thử nghiệm · AI chỉ hướng dẫn, không tự duyệt / lưu thay bạn. Lịch sử chat lưu theo tài khoản của bạn."
          onClose={() => setOpen(false)}
        />
      )}
      {!running && (
        <button
          type="button"
          data-tour-ignore
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Đóng trợ lý hướng dẫn" : "Mở trợ lý hướng dẫn"}
          title="Trợ lý hướng dẫn sử dụng (thử nghiệm)"
          className="fixed bottom-4 right-4 z-[61] flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95"
        >
          {open ? <XIcon size={22} weight="bold" /> : <ChatCircleDotsIcon size={24} weight="fill" />}
          {!open && (
            <span className="absolute -top-1.5 -left-2 rounded-full bg-amber-400 px-1.5 py-px text-[9px] font-black uppercase tracking-wide text-amber-950 shadow">
              Beta
            </span>
          )}
        </button>
      )}
    </>
  );
}
