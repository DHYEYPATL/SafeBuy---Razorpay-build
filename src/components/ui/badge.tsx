import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: "neutral" | "live" | "synth" | "ok" | "warn" | "bad";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-surface text-muted border-border",
    live: "bg-live/15 text-live border-live/30",
    synth: "bg-synth/15 text-synth border-synth/30",
    ok: "bg-ok/15 text-ok border-ok/30",
    warn: "bg-warn/15 text-warn border-warn/30",
    bad: "bg-danger/15 text-danger border-danger/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
