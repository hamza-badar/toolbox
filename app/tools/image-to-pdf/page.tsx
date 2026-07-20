"use client";

import * as React from "react";
import { FileDown, RefreshCw, GripVertical, X, Pencil } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { FilenameField, buildFilename } from "@/components/shared/filename-field";
import { ImageEditDialog, type ImageEdits } from "@/components/shared/image-edit-dialog";
import { TargetSizeField } from "@/components/shared/target-size-field";
import { AlertDialog } from "@/components/shared/alert-dialog";
import { loadImageFromBlob, canvasToBlob } from "@/lib/image";
import { downloadBlob, formatBytes, withExtension } from "@/lib/utils";

interface Item {
  id: string;
  /** Pristine upload — edits always re-apply from here, never compounding. */
  original: File;
  file: File;
  url: string;
  edits?: ImageEdits;
  edited?: boolean;
}

// Page sizes in PDF points (72 pt/in).
const PAGE_SIZES: Record<string, [number, number] | null> = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

/**
 * Encode all images to JPEG under a shared quality/scale chosen by binary search
 * so the combined bytes land at/under a target. Returns JPEG bytes per image.
 */
async function encodeToTarget(
  imgs: HTMLImageElement[],
  targetBytes: number,
  onProgress?: (info: string) => void
): Promise<Uint8Array[]> {
  const overhead = 2048 + imgs.length * 512;
  let scale = 1;
  const minScale = 0.35;

  const renderAll = (scl: number) =>
    imgs.map((img) => {
      const w = Math.max(16, Math.round(img.naturalWidth * scl));
      const h = Math.max(16, Math.round(img.naturalHeight * scl));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; // JPEG has no alpha
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return c;
    });

  const toBytes = async (blobs: Blob[]) =>
    Promise.all(blobs.map(async (b) => new Uint8Array(await b.arrayBuffer())));

  for (let attempt = 0; attempt < 5; attempt++) {
    const canvases = renderAll(scale);
    let lo = 0.15;
    let hi = 0.95;
    let chosen: Blob[] | null = null;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      onProgress?.(`Scale ${(scale * 100) | 0}% · quality ${(q * 100) | 0}%`);
      const blobs = await Promise.all(canvases.map((c) => canvasToBlob(c, "jpeg", q)));
      const total = overhead + blobs.reduce((s, b) => s + b.size, 0);
      if (total <= targetBytes) {
        chosen = blobs;
        lo = q;
      } else {
        hi = q;
      }
    }
    if (chosen) return toBytes(chosen);

    const floor = await Promise.all(canvases.map((c) => canvasToBlob(c, "jpeg", 0.15)));
    const floorTotal = overhead + floor.reduce((s, b) => s + b.size, 0);
    if (floorTotal <= targetBytes || scale * 0.8 < minScale) return toBytes(floor);
    scale *= 0.8;
  }
  const canvases = renderAll(minScale);
  const floor = await Promise.all(canvases.map((c) => canvasToBlob(c, "jpeg", 0.15)));
  return toBytes(floor);
}

export default function ImageToPdfPage() {
  const tool = getTool("image-to-pdf")!;
  const [items, setItems] = React.useState<Item[]>([]);
  const [pageSize, setPageSize] = React.useState("a4");
  const [orientation, setOrientation] = React.useState<"portrait" | "landscape">("portrait");
  const [marginPct, setMarginPct] = React.useState(5);
  const [targetMode, setTargetMode] = React.useState(false);
  const [targetKB, setTargetKB] = React.useState<number | null>(500);
  const [outName, setOutName] = React.useState("images");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [result, setResult] = React.useState<{ size: number; met: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [invalidAlert, setInvalidAlert] = React.useState(false);
  const dragIndex = React.useRef<number | null>(null);

  const invalidTarget = targetMode && (targetKB === null || targetKB < 20);

  const editing = items.find((it) => it.id === editingId) ?? null;

  function addFiles(files: File[]) {
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        original: file,
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
    setError(null);
    setResult(null);
  }

  function applyEdit(id: string, blob: Blob, edits: ImageEdits) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        URL.revokeObjectURL(it.url);
        // Edited output is a PNG derived from the pristine original.
        const edited = new File([blob], withExtension(it.original.name, "png"), { type: "image/png" });
        return { ...it, file: edited, url: URL.createObjectURL(edited), edits, edited: true };
      })
    );
    setEditingId(null);
    setResult(null);
  }

  function remove(id: string) {
    setItems((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function reorder(from: number, to: number) {
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function build() {
    if (invalidTarget) {
      setInvalidAlert(true);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();

      // In target-size mode, pre-encode every image to JPEG at a shared quality.
      let targetJpegs: Uint8Array[] | null = null;
      if (targetMode) {
        const target = targetKB as number;
        setProgress({ value: null, status: "Finding the best quality for your target size…" });
        const imgs = await Promise.all(items.map((it) => loadImageFromBlob(it.file)));
        targetJpegs = await encodeToTarget(imgs, target * 1024, (info) =>
          setProgress({ value: null, status: info })
        );
      }

      for (let i = 0; i < items.length; i++) {
        setProgress({ value: (i / items.length) * 100, status: `Adding image ${i + 1} of ${items.length}…` });
        const type = items[i].file.type;

        let embedded;
        if (targetJpegs) {
          embedded = await doc.embedJpg(targetJpegs[i]);
        } else if (type === "image/jpeg" || type === "image/jpg") {
          embedded = await doc.embedJpg(new Uint8Array(await items[i].file.arrayBuffer()));
        } else if (type === "image/png") {
          embedded = await doc.embedPng(new Uint8Array(await items[i].file.arrayBuffer()));
        } else {
          // Convert unsupported types (webp/avif/gif) to PNG via canvas first.
          embedded = await doc.embedPng(await toPngBytes(items[i].url));
        }

        const base = PAGE_SIZES[pageSize];
        let pw: number;
        let ph: number;
        if (base) {
          [pw, ph] = orientation === "landscape" ? [base[1], base[0]] : base;
        } else {
          pw = embedded.width;
          ph = embedded.height;
        }

        const page = doc.addPage([pw, ph]);
        const margin = base ? (Math.min(pw, ph) * marginPct) / 100 : 0;
        const availW = pw - margin * 2;
        const availH = ph - margin * 2;
        const scale = base ? Math.min(availW / embedded.width, availH / embedded.height) : 1;
        const dw = embedded.width * scale;
        const dh = embedded.height * scale;
        page.drawImage(embedded, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }

      setProgress({ value: 100, status: "Saving PDF…" });
      const out = await doc.save();
      const blob = new Blob([out as BlobPart], { type: "application/pdf" });
      setResult({ size: blob.size, met: !targetMode || blob.size <= (targetKB ?? 0) * 1024 });
      downloadBlob(blob, buildFilename(outName, "pdf", "images"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build PDF.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="space-y-6">
        <Dropzone
          accept="image/*"
          multiple
          enableCamera
          onFiles={addFiles}
          title={items.length ? "Add more images" : "Drop images to combine into a PDF"}
          hint="JPEG, PNG, WebP · drag to reorder after adding"
        />

        {items.length > 0 && (
          <>
            <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
              <div>
                <Label className="mb-1.5 block">Page size</Label>
                <Select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="legal">US Legal</option>
                  <option value="fit">Fit to each image</option>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Orientation</Label>
                <Select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as "portrait" | "landscape")}
                  disabled={pageSize === "fit"}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Margin — {marginPct}%</Label>
                <Slider
                  value={marginPct}
                  min={0}
                  max={20}
                  onChange={setMarginPct}
                  disabled={pageSize === "fit"}
                />
              </div>
            </div>

            {/* Output size + name */}
            <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
              <div className="sm:col-span-2 flex items-center justify-between">
                <div>
                  <Label htmlFor="target-mode">Compress to a target size</Label>
                  <p className="text-xs text-muted-foreground">
                    Re-encodes images as JPEG to approach a specific PDF size.
                  </p>
                </div>
                <Switch id="target-mode" checked={targetMode} onCheckedChange={setTargetMode} />
              </div>
              {targetMode && (
                <TargetSizeField
                  id="target-kb"
                  label="Target size (KB)"
                  value={targetKB ?? 500}
                  onChange={setTargetKB}
                  min={20}
                />
              )}
              <FilenameField
                value={outName}
                onChange={setOutName}
                extension="pdf"
                className={targetMode ? "" : "sm:col-span-2"}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {items.map((item, i) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null) reorder(dragIndex.current, i);
                    dragIndex.current = null;
                  }}
                  className="group relative overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.file.name} className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-1.5">
                    <span className="flex items-center gap-1 text-xs text-white">
                      <GripVertical className="size-3.5" /> {i + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingId(item.id)}
                        className="rounded bg-black/40 p-1 text-white hover:bg-accent"
                        aria-label={`Edit ${item.original.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => remove(item.id)}
                        className="rounded bg-black/40 p-1 text-white hover:bg-destructive"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1">
                    <p className="truncate text-[11px] text-muted-foreground">
                      {formatBytes(item.file.size)}
                    </p>
                    {item.edited && (
                      <span className="rounded bg-accent-muted px-1.5 text-[10px] font-medium text-accent">
                        edited
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {progress && <ProgressBar value={progress.value} status={progress.status} />}
            {error && <ErrorAlert message={error} />}

            {result && (
              <p className={`text-sm ${result.met ? "text-success" : "text-warning"}`}>
                Created {buildFilename(outName, "pdf", "images")} — {formatBytes(result.size)}
                {targetMode &&
                  (result.met
                    ? ` (under your ${targetKB} KB target)`
                    : ` · couldn't fully reach ${targetKB} KB at a legible quality`)}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={build} disabled={busy}>
                <FileDown className="size-4" />
                Create PDF ({items.length} page{items.length > 1 ? "s" : ""})
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  items.forEach((it) => URL.revokeObjectURL(it.url));
                  setItems([]);
                  setResult(null);
                }}
                disabled={busy}
              >
                <RefreshCw className="size-4" />
                Clear all
              </Button>
            </div>
          </>
        )}
      </div>

      {editing && (
        <ImageEditDialog
          file={editing.original}
          initialEdits={editing.edits}
          onApply={({ blob, edits }) => applyEdit(editing.id, blob, edits)}
          onClose={() => setEditingId(null)}
        />
      )}
      {invalidAlert && (
        <AlertDialog
          title="Fix the target size first"
          message="Enter a target size of at least 20 KB before creating the PDF."
          onClose={() => setInvalidAlert(false)}
        />
      )}
    </ToolShell>
  );
}

async function toPngBytes(url: string): Promise<Uint8Array> {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
  );
  return new Uint8Array(await blob.arrayBuffer());
}
