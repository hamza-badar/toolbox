"use client";

import * as React from "react";
import { Download, Package, RefreshCw, Loader2 } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { decodeGifFrames, type GifFrame } from "@/lib/gif";
import { canvasToBlob, LOSSY_FORMATS, type ImageFormat } from "@/lib/image";
import { zipBlobs } from "@/lib/zip";
import { downloadBlob, cn } from "@/lib/utils";

export default function GifToImagePage() {
  const tool = getTool("gif-to-image")!;
  const [frames, setFrames] = React.useState<GifFrame[]>([]);
  const [thumbs, setThumbs] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [format, setFormat] = React.useState<ImageFormat>("png");
  const [outName, setOutName] = React.useState("frames");
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onFile(file: File) {
    setLoading(true);
    setError(null);
    setFrames([]);
    setThumbs([]);
    setSelected(new Set());
    setOutName(sanitizeBaseName(file.name) || "frames");
    try {
      const decoded = await decodeGifFrames(file);
      setFrames(decoded);
      setThumbs(decoded.map((f) => f.canvas.toDataURL("image/png")));
      setSelected(new Set(decoded.map((f) => f.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decode this GIF.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const q = LOSSY_FORMATS.includes(format) ? 0.92 : undefined;

  const base = () => sanitizeBaseName(outName) || "frames";

  async function exportFrame(frame: GifFrame) {
    const blob = await canvasToBlob(frame.canvas, format, q);
    downloadBlob(blob, `${base()}_${String(frame.index + 1).padStart(4, "0")}.${format}`);
  }

  async function exportSelected() {
    setBusy(true);
    setError(null);
    try {
      const chosen = frames.filter((f) => selected.has(f.index));
      if (!chosen.length) {
        setError("Select at least one frame.");
        return;
      }
      if (chosen.length === 1) {
        await exportFrame(chosen[0]);
        return;
      }
      const entries = [];
      for (const f of chosen) {
        const blob = await canvasToBlob(f.canvas, format, q);
        entries.push({ name: `${base()}_${String(f.index + 1).padStart(4, "0")}.${format}`, blob });
      }
      downloadBlob(await zipBlobs(entries), buildFilename(outName, "zip", "gif-frames"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="space-y-6">
        {frames.length === 0 && (
          <Dropzone
            accept="image/gif,.gif"
            warnSizeMB={80}
            onFiles={(f) => onFile(f[0])}
            disabled={loading}
            title="Drop a GIF to split into frames"
            hint="Extract every frame as PNG, JPEG or WebP"
          />
        )}

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-accent" /> Decoding frames…
          </p>
        )}
        {error && <ErrorAlert message={error} />}

        {frames.length > 0 && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {frames.length} frames · {selected.size} selected
                </span>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(frames.map((f) => f.index)))}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <FilenameField
                  value={outName}
                  onChange={setOutName}
                  extension={selected.size > 1 ? "zip" : format}
                  label="Name"
                  className="w-40"
                />
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Format</Label>
                  <Select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)} className="w-32">
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </Select>
                </div>
                <Button onClick={exportSelected} disabled={busy}>
                  {selected.size > 1 ? <Package className="size-4" /> : <Download className="size-4" />}
                  Export {selected.size > 1 ? `${selected.size} (ZIP)` : "frame"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {frames.map((frame, i) => (
                <button
                  key={frame.index}
                  onClick={() => toggle(frame.index)}
                  className={cn(
                    "group relative overflow-hidden rounded-lg border-2 bg-muted text-left transition-colors",
                    selected.has(frame.index) ? "border-accent" : "border-border"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbs[i]}
                    alt={`Frame ${frame.index + 1}`}
                    className="aspect-square w-full bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
                  />
                  <div className="flex items-center justify-between px-2 py-1 text-[11px]">
                    <span className="font-medium">#{frame.index + 1}</span>
                    <span className="text-muted-foreground">{frame.delayMs}ms</span>
                  </div>
                  {selected.has(frame.index) && (
                    <span className="absolute right-1.5 top-1.5 size-4 rounded-full bg-accent ring-2 ring-card" />
                  )}
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              onClick={() => {
                setFrames([]);
                setThumbs([]);
                setSelected(new Set());
              }}
              disabled={busy}
            >
              <RefreshCw className="size-4" />
              Choose another GIF
            </Button>
          </>
        )}
      </div>
    </ToolShell>
  );
}
