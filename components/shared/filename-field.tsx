"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FilenameFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Extension shown as a suffix, e.g. "pdf", "gif", "zip". */
  extension: string;
  label?: string;
  id?: string;
  className?: string;
}

/** Strip any path/extension and illegal characters from a base filename. */
export function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
}

/** Combine a user-entered base name with an extension, with a safe fallback. */
export function buildFilename(base: string, extension: string, fallback = "toolbox-output"): string {
  const clean = sanitizeBaseName(base) || fallback;
  return `${clean}.${extension.replace(/^\./, "")}`;
}

export function FilenameField({
  value,
  onChange,
  extension,
  label = "Output file name",
  id,
  className,
}: FilenameFieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
      </Label>
      <div className="flex items-stretch">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="file-name"
          className={cn("rounded-r-none")}
        />
        <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
          .{extension}
        </span>
      </div>
    </div>
  );
}
