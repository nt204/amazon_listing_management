"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="grid min-w-0 gap-1">
      <label className="text-[12px] font-semibold text-[#39444d]" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-[#b84f1d]">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] leading-4 text-[#b32921]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-4 text-[#65717c]">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field-control ${props.className || ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`field-control resize-y ${props.className || ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field-control ${props.className || ""}`} />;
}

export function Switch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-3 text-xs text-[#39444d]" htmlFor={id}>
      <span>{label}</span>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          className="peer sr-only"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-5 w-9 rounded-full border border-[#b8c0c6] bg-[#dfe3e6] transition-colors peer-checked:border-[#b84f1d] peer-checked:bg-[#b84f1d] peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#e7aa8d]" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-bold text-[#222b32]">{children}</h2>;
}
