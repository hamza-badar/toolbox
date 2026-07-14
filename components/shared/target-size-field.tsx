"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TargetSizeFieldProps {
  id?: string;
  label?: string;
  /** Last known-valid numeric value, used only to seed/reset the field — not forced back while typing. */
  value: number;
  /** Fires with a parsed number while the field holds a valid value, or null while it doesn't. */
  onChange: (value: number | null) => void;
  min: number;
  max?: number;
  unit?: string;
  hint?: string;
  step?: number;
  className?: string;
  disabled?: boolean;
  /** Change this when the field's default should be reseeded (e.g. a new file was dropped). */
  resetKey?: string | number;
}

export function TargetSizeField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  unit = "KB",
  hint,
  step,
  className,
  disabled,
  resetKey,
}: TargetSizeFieldProps) {
  const [raw, setRaw] = React.useState(String(value));
  const lastResetKey = React.useRef(resetKey);

  React.useEffect(() => {
    if (resetKey !== lastResetKey.current) {
      lastResetKey.current = resetKey;
      setRaw(String(value));
    }
    // Only reseed when resetKey changes — never while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const trimmed = raw.trim();
  const parsed = trimmed === "" ? NaN : Number(trimmed);
  const invalid = trimmed === "" || Number.isNaN(parsed) || parsed < min || (max !== undefined && parsed > max);

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block">
          {label}
        </Label>
      )}
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={raw}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => {
          const v = e.target.value;
          setRaw(v);
          const t = v.trim();
          const n = Number(t);
          onChange(t !== "" && !Number.isNaN(n) ? n : null);
        }}
        className={cn(
          invalid && "border-destructive text-destructive focus-visible:ring-destructive"
        )}
      />
      {invalid ? (
        <p className="mt-1 text-xs text-destructive">
          {trimmed === ""
            ? `Enter a target size in ${unit}.`
            : max !== undefined
              ? `Must be between ${min} and ${max} ${unit}.`
              : `Must be at least ${min} ${unit}.`}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
