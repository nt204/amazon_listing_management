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
    <div className="grid min-w-0 gap-1.5">
      <label className="text-xs font-bold text-slate-700 flex items-center justify-between" htmlFor={htmlFor}>
        <span>
          {label}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </span>
      </label>
      {children}
      {error ? (
        <p className="text-[11px] font-medium leading-4 text-rose-600 flex items-center gap-1" role="alert">
          <span>⚠️</span> {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-4 text-slate-500">{hint}</p>
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
    <label className="flex min-h-8 items-center justify-between gap-3 text-xs font-semibold text-slate-700 cursor-pointer select-none" htmlFor={id}>
      <span>{label}</span>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          className="peer sr-only"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-5 w-9 rounded-full border border-slate-300 bg-slate-200 transition-colors duration-200 peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform duration-200 peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">{children}</h2>;
}

