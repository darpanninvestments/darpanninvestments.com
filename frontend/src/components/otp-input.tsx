"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Six-box one-time-code input: auto-advance, backspace, arrow keys, paste and SMS/email autofill. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid, length = 6 }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void;
  disabled?: boolean; invalid?: boolean; length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();
  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };
  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} disabled={disabled}
          inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={i === 0 ? length : 1}
          aria-label={`Digit ${i + 1}`} autoFocus={i === 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) { set(v); focus(v.length); return; } // paste / autofill into a box
            const arr = digits.slice(); arr[i] = v; set(arr.join(""));
            if (v) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d) { e.preventDefault(); const arr = digits.slice(); arr[i - 1] = ""; set(arr.join("")); focus(i - 1); }
            if (e.key === "ArrowLeft") focus(i - 1);
            if (e.key === "ArrowRight") focus(i + 1);
          }}
          onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text"); set(t); focus(t.replace(/\D/g, "").length); }}
          className={cn(
            "h-12 w-full min-w-0 rounded-xl border bg-white text-center text-xl font-semibold text-slate-900 outline-none transition sm:h-14 sm:text-2xl",
            "focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:bg-slate-50",
            invalid ? "border-red-300 bg-red-50/50" : d ? "border-slate-300" : "border-border",
          )} />
      ))}
    </div>
  );
}
