"use client";

// Chú thích "Helium 10 cập nhật lúc …" ở đầu các tab Target, Search Term, Đề xuất & Auto Bid, Manual Bid.
import { useEffect, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";

type H10Updated = { searchVolumeAt: string | null; rankAt: string | null };

const fmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const fmtShort = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "25/11 09:53" theo giờ Việt Nam */
function shortLabel(iso: string): string {
  const parts = fmtShort.formatToParts(new Date(iso));
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value || "";
  return `${v("day")}/${v("month")} ${v("hour")}:${v("minute")}`;
}

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

export function PpcH10UpdatedNote() {
  const [data, setData] = useState<H10Updated | null>(null);
  // Mốc "bây giờ" lấy lúc tải xong để tính "x ngày trước" (không gọi Date.now() khi render)
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ppc/h10-updated")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.success) {
          setData(json.data);
          setNow(Date.now());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  // Mốc mới nhất của SV hoặc rank (đồng bộ H10 cập nhật cả hai)
  const latest = [data.searchVolumeAt, data.rankAt]
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  if (!latest) return null;
  const stale = now - new Date(latest).getTime() > 7 * 24 * 3600 * 1000;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${
        stale ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-500"
      }`}
      title={[
        `Helium 10 cập nhật ${ago(latest, now)}`,
        data.searchVolumeAt ? `Search Volume: ${fmt.format(new Date(data.searchVolumeAt))}` : null,
        data.rankAt ? `Organic / Sponsored rank: ${fmt.format(new Date(data.rankAt))}` : null,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <ClockCounterClockwise size={12} weight="bold" />
      Helium · {shortLabel(latest)}
    </span>
  );
}
