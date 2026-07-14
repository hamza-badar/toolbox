"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** 0–100, or null/undefined for indeterminate. */
  value?: number | null;
  status?: string;
  className?: string;
}

export function ProgressBar({ value, status, className }: ProgressBarProps) {
  const indeterminate = value == null || Number.isNaN(value);
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-accent" />
          {status ?? "Working…"}
        </span>
        {!indeterminate && (
          <span className="font-mono tabular-nums text-foreground">{Math.round(pct)}%</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {indeterminate ? (
          <motion.div
            className="h-full w-1/3 rounded-full bg-accent"
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <motion.div
            className="h-full rounded-full bg-accent"
            animate={{ width: `${pct}%` }}
            transition={{ ease: "easeOut", duration: 0.3 }}
          />
        )}
      </div>
    </div>
  );
}
