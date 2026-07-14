"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { UploadCloud, AlertCircle } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

interface DropzoneProps {
  /** Comma-separated accept string, e.g. "image/*" or ".pdf,application/pdf". */
  accept?: string;
  multiple?: boolean;
  /** Soft warning threshold in MB (files above this warn but are still accepted). */
  warnSizeMB?: number;
  /** Hard reject threshold in MB. */
  maxSizeMB?: number;
  onFiles: (files: File[]) => void;
  title?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const parts = accept.split(",").map((p) => p.trim().toLowerCase());
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return parts.some((p) => {
    if (!p) return false;
    if (p.startsWith(".")) return name.endsWith(p);
    if (p.endsWith("/*")) return type.startsWith(p.slice(0, -1));
    return type === p;
  });
}

export function Dropzone({
  accept,
  multiple = false,
  warnSizeMB,
  maxSizeMB,
  onFiles,
  title = "Drop your file here",
  hint,
  disabled,
  className,
}: DropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  const handleFiles = React.useCallback(
    (fileList: FileList | null) => {
      setError(null);
      setWarning(null);
      if (!fileList || fileList.length === 0) return;
      let files = Array.from(fileList);
      if (!multiple) files = files.slice(0, 1);

      const rejected = files.filter((f) => !matchesAccept(f, accept));
      if (rejected.length) {
        setError(
          `Unsupported file type: ${rejected.map((f) => f.name).join(", ")}. Expected ${accept}.`
        );
        return;
      }

      if (maxSizeMB) {
        const tooBig = files.filter((f) => f.size > maxSizeMB * 1024 * 1024);
        if (tooBig.length) {
          setError(
            `File too large (max ${maxSizeMB} MB): ${tooBig
              .map((f) => `${f.name} — ${formatBytes(f.size)}`)
              .join(", ")}`
          );
          return;
        }
      }

      if (warnSizeMB) {
        const big = files.filter((f) => f.size > warnSizeMB * 1024 * 1024);
        if (big.length) {
          setWarning(
            `Large file${big.length > 1 ? "s" : ""} (${big
              .map((f) => formatBytes(f.size))
              .join(", ")}). Processing runs in your browser's memory and may be slow.`
          );
        }
      }

      onFiles(files);
    },
    [accept, multiple, maxSizeMB, warnSizeMB, onFiles]
  );

  return (
    <div className={className}>
      <motion.button
        type="button"
        disabled={disabled}
        whileTap={{ scale: 0.995 }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-muted/60"
            : "border-border bg-muted/40 hover:border-accent/60 hover:bg-muted",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-full transition-colors",
            dragging ? "bg-accent text-accent-foreground" : "bg-card text-accent"
          )}
        >
          <UploadCloud className="size-7" />
        </span>
        <span className="text-base font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">
          {hint ?? (
            <>
              Drag &amp; drop or <span className="text-accent">browse</span>
              {multiple ? " — multiple files supported" : ""}
            </>
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </motion.button>

      {error && (
        <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {warning && !error && (
        <p className="mt-3 flex items-start gap-2 text-sm text-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}
