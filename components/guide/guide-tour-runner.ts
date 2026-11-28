"use client";

// Chạy 1 kịch bản hướng dẫn: làm sáng phần tử (driver.js, MIT) + con trỏ giả tự bấm các thao tác xem / lọc.
// Cách bấm học theo alibaba/page-agent (packages/page-controller/src/actions.ts): cuộn tới phần tử, di con trỏ tới
// tâm, phát pointer/mouse event theo đúng thứ tự trình duyệt rồi gọi click().
// AN TOÀN: con trỏ giả KHÔNG bấm nút có chữ Duyệt / Lưu / Xóa / Upload… (chặn ở đây, không chỉ dựa vào kịch bản).

import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./guide-tour.css";
import type { GuideAction, GuideTour, GuideTourStep } from "@/lib/guide/types";

export type GuideTourMode = "auto" | "manual";

const FIND_TIMEOUT_MS = 4000;
const CURSOR_MOVE_MS = 650;
// Nút làm thay đổi dữ liệu thật: tuyệt đối không bấm thay người dùng
// (nút chỉ MỞ cửa sổ mà chữ trùng — vd "Xuất Bulk File" mở hộp kiểm tra — gắn data-tour-safe)
const UNSAFE_LABEL = /^(duyệt|lưu|xóa|xoá|upload|đẩy|gửi|xác nhận|áp dụng|bật|tắt|tải|xuất|bắt đầu|xếp hàng|hoàn bid|save|delete|approve|confirm|apply|submit|download|export)/i;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const selector = (key: string) => `[data-tour="${CSS.escape(key)}"]`;

function isVisible(el: Element) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** Phần tử đầu tiên đang hiển thị có data-tour = key (bảng ẩn theo tab vẫn còn trong DOM nên phải lọc). */
function findVisible(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector(key))) if (isVisible(el)) return el;
  return null;
}

function findAny(keys: string[]): HTMLElement | null {
  for (const key of keys) {
    const el = findVisible(key);
    if (el) return el;
  }
  return null;
}

/** Đợi tới khi 1 trong các khóa xuất hiện (khóa đầu ưu tiên). */
async function waitForElement(key: string | string[], signal: AbortSignal, timeout = FIND_TIMEOUT_MS) {
  const keys = Array.isArray(key) ? key : [key];
  const until = Date.now() + timeout;
  while (!signal.aborted) {
    const el = findAny(keys);
    if (el) return el;
    if (Date.now() > until) return null;
    await sleep(120, signal);
  }
  return null;
}

/** Con trỏ giả (mũi tên + vòng sóng khi bấm), nằm trên lớp phủ của driver.js. */
class GhostCursor {
  private el: HTMLDivElement;
  private x = window.innerWidth - 60;
  private y = window.innerHeight - 60;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "nce-guide-cursor";
    this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l15 9.2-6.6 1.4-3.3 6.4z" fill="#4f46e5" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="nce-guide-cursor-ripple"></span>';
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    document.body.appendChild(this.el);
  }

  async moveTo(x: number, y: number, signal: AbortSignal) {
    this.x = x;
    this.y = y;
    this.el.style.opacity = "1";
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(CURSOR_MOVE_MS, signal);
  }

  async press(signal: AbortSignal) {
    this.el.classList.remove("is-pressing");
    void this.el.offsetWidth; // chạy lại animation
    this.el.classList.add("is-pressing");
    await sleep(220, signal);
  }

  hide() {
    this.el.style.opacity = "0";
  }

  destroy() {
    this.el.remove();
  }
}

function dispatchClick(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const target = hit instanceof HTMLElement && el.contains(hit) ? hit : el;
  const pointer = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "mouse" } as const;
  const mouse = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 } as const;
  target.dispatchEvent(new PointerEvent("pointerover", pointer));
  target.dispatchEvent(new MouseEvent("mouseover", mouse));
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", mouse));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", mouse));
  target.click();
}

function assertSafe(el: HTMLElement, key: string) {
  if (el.closest("[data-tour-safe]")) return;
  // Chỉ xét nút / link: dòng bảng (vd keyword "download …") không phải lệnh
  if (!el.matches("button, a, [role=button], input[type=submit], input[type=button]")) return;
  // Bỏ ký hiệu đầu chuỗi (⚡, ▶…) trước khi so: "⚡ Bắt Đầu Auto Upload" vẫn bị chặn
  const label = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/^[^\p{L}]+/u, "");
  if (UNSAFE_LABEL.test(label)) throw new Error(`Kịch bản định bấm nút "${label}" (${key}) — đã chặn vì nút này thay đổi dữ liệu.`);
}

export interface RunTourOptions {
  mode: GuideTourMode;
  onEnd?: (result: { completed: boolean; stepsShown: number }) => void;
}

/** Bắt đầu kịch bản; trả về hàm dừng. */
export function runGuideTour(tour: GuideTour, options: RunTourOptions): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const cursor = new GhostCursor();
  let auto = options.mode === "auto";
  let index = -1;
  let busy = false;
  let shown = 0;
  let ended = false;
  let autoTimer: ReturnType<typeof setTimeout> | null = null;

  const drv: Driver = driver({
    animate: true,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    allowClose: true,
    smoothScroll: true,
    popoverClass: "nce-guide-popover",
    // Người dùng không vô tình bấm vào trang khi đang xem hướng dẫn
    disableActiveInteraction: true,
    overlayClickBehavior: "none",
    allowKeyboardControl: false,
    onDestroyStarted: () => void finish(false),
  });

  const clearAuto = () => {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
  };

  async function perform(action: GuideAction, animate: boolean) {
    if (action.type === "wait") return sleep(action.ms, signal);
    const el = action.ifPresent ? findVisible(action.target) : await waitForElement(action.target, signal);
    if (!el) {
      if (action.ifPresent) return;
      throw new Error(`missing:${action.target}`);
    }
    assertSafe(el, action.target);
    if (animate) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      await sleep(250, signal);
      const rect = el.getBoundingClientRect();
      await cursor.moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2, signal);
      await cursor.press(signal);
    }
    if (signal.aborted) return;
    dispatchClick(el);
    await sleep(animate ? 450 : 150, signal);
  }

  const readingTime = (step: GuideTourStep) =>
    Math.min(11_000, Math.max(3800, (step.title.length + step.body.replace(/<[^>]+>/g, "").length) * 55));

  function scheduleAuto(step: GuideTourStep) {
    clearAuto();
    if (auto) autoTimer = setTimeout(() => void go(index + 1, false), readingTime(step));
  }

  // Bước bắt buộc vừa không thấy phần tử (vd hàng đợi trống nên hộp Xuất không mở) → các bước phụ (optional) tiếp theo
  // trong cùng "cảnh" chắc chắn cũng không có: bỏ qua ngay, không đợi. Bước có thao tác `before` mở cảnh mới.
  let sceneBroken = false;

  function render(step: GuideTourStep, at: number, el: HTMLElement | null) {
    index = at;
    shown += 1;
    const missing = Boolean(step.target) && !el;
    const canGoBack = at > 0 && !step.before?.length;
    const isLast = at === tour.steps.length - 1;
    if (el) {
      const rect = el.getBoundingClientRect();
      void cursor.moveTo(rect.left + Math.min(rect.width - 6, 18), rect.top + rect.height / 2, signal);
    } else cursor.hide();
    drv.highlight({
      element: el ?? undefined,
      popover: {
        title: step.title,
        description: missing
          ? `${step.body}<p class="nce-guide-missing">⚠ ${step.missingText ?? "Không thấy phần này trên màn hình hiện tại (có thể store chưa có dữ liệu)."}</p>`
          : step.body,
        side: step.side,
        align: "start",
        showButtons: canGoBack ? ["previous", "next", "close"] : ["next", "close"],
        progressText: `${at + 1}/${tour.steps.length}`,
        showProgress: true,
        nextBtnText: isLast ? "Xong ✓" : "Tiếp →",
        prevBtnText: "← Lùi",
        onNextClick: () => void go(index + 1, false),
        onPrevClick: () => void go(index - 1, true),
        onCloseClick: () => void finish(false),
        onPopoverRender: (popover) => {
          // Nút Tự chạy / Tạm dừng
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "nce-guide-autoplay";
          const paint = () => (toggle.textContent = auto ? "⏸ Tạm dừng" : "▶ Tự chạy");
          paint();
          toggle.onclick = () => {
            auto = !auto;
            paint();
            if (auto) scheduleAuto(step);
            else clearAuto();
          };
          popover.footerButtons.prepend(toggle);
        },
      },
    });
    scheduleAuto(step);
  }

  /** Chuyển tới bước `start` (bỏ qua bước phụ không có trên màn hình). Đang chuyển thì bỏ qua mọi lần bấm thêm. */
  async function go(start: number, backward: boolean) {
    if (busy || ended || signal.aborted) return;
    clearAuto();
    busy = true;
    try {
      for (let at = start; ; at += backward ? -1 : 1) {
        if (at >= tour.steps.length) return void finish(true);
        if (at < 0) return;
        const step = tour.steps[at];
        // Lùi lại không chạy lại thao tác (cửa sổ đã mở vẫn còn); chỉ cho lùi trong cùng "cảnh" (xem canGoBack)
        if (!backward && step.before?.length) {
          sceneBroken = false;
          if (drv.isActive()) drv.highlight({ popover: { title: "Đang thao tác…", description: "Xem con trỏ làm mẫu nhé.", showButtons: ["close"], onCloseClick: () => void finish(false) } });
          for (const action of step.before) await perform(action, true);
        }
        if (signal.aborted) return;
        let el: HTMLElement | null = null;
        if (step.target) {
          const keys = Array.isArray(step.target) ? step.target : [step.target];
          el = step.optional && sceneBroken ? findAny(keys) : await waitForElement(keys, signal, step.optional ? 2500 : FIND_TIMEOUT_MS);
          if (signal.aborted) return;
          if (!el && step.optional) continue;
          if (!el) sceneBroken = true;
        }
        return render(step, at, el);
      }
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error && error.message.startsWith("missing:")
        ? "Màn hình hiện tại chưa có phần cần làm mẫu (có thể store chưa có SKU / đang tải). Bạn thử lại khi bảng đã có dữ liệu nhé."
        : error instanceof Error ? error.message : "Không chạy tiếp được hướng dẫn.";
      cursor.hide();
      drv.highlight({
        popover: { title: "Dừng hướng dẫn", description: message, showButtons: ["close"], onCloseClick: () => void finish(false) },
      });
    } finally {
      busy = false;
    }
  }

  async function finish(completed: boolean) {
    if (ended) return;
    ended = true;
    clearAuto();
    controller.abort();
    cursor.destroy();
    if (drv.isActive()) drv.destroy();
    // Dọn màn hình: đóng cửa sổ đã mở, bỏ bộ lọc demo (không animation)
    for (const action of tour.cleanup ?? []) {
      if (action.type !== "click") continue;
      const el = findVisible(action.target);
      if (!el) continue;
      try {
        assertSafe(el, action.target);
        dispatchClick(el);
        await sleep(150);
      } catch {
        // bỏ qua bước dọn dẹp lỗi
      }
    }
    options.onEnd?.({ completed, stepsShown: shown });
  }

  void go(0, false);
  return () => void finish(false);
}
