import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RackMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("text-primary", className)} fill="none" aria-hidden>
      <rect x="4" y="3" width="16" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4" y="9.5" width="16" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4" y="16" width="16" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7.5" cy="5.5" r="0.9" fill="currentColor" />
      <circle cx="7.5" cy="12" r="0.9" fill="currentColor" />
      <circle cx="7.5" cy="18.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function SectionKicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-sm tracking-widest text-primary">{n}</span>
      <span className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </span>
    </div>
  );
}
