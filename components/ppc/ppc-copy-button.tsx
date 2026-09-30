"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";

interface PpcCopyButtonProps {
  value?: string | null;
  label: string;
  size?: number;
  className?: string;
  onCopied?: (value: string) => void;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard API unavailable");
}

export function PpcCopyButton({
  value,
  label,
  size = 12,
  className = "",
  onCopied,
}: PpcCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedValue = value?.trim() || "";

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  if (!normalizedValue) return null;

  return (
    <button
      type="button"
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await copyToClipboard(normalizedValue);
          setCopied(true);
          onCopied?.(normalizedValue);
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => setCopied(false), 1_500);
        } catch {
          setCopied(false);
        }
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 cursor-pointer ${className}`}
      title={copied ? `Đã sao chép ${label}` : `Sao chép ${label}`}
      aria-label={copied ? `Đã sao chép ${label}` : `Sao chép ${label}`}
    >
      {copied ? (
        <Check size={size} weight="bold" className="text-emerald-600" />
      ) : (
        <Copy size={size} />
      )}
    </button>
  );
}
