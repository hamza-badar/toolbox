"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** Native range input styled via globals.css. */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  id,
  disabled,
  className,
}: SliderProps) {
  return (
    <input
      type="range"
      id={id}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("w-full", className)}
    />
  );
}
