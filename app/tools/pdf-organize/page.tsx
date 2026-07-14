"use client";

import * as React from "react";
import type { PDFDocument } from "pdf-lib";
import { FileDown, RefreshCw, RotateCw, X, Scissors, GripVertical, Loader2 } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilenameField, buildFilename } from "@/components/shared/filename-field";
import { loadPdfDocument, renderThumbnail } from "@/lib/pdf";
import { zipBlobs } from "@/lib/zip";
import { downloadBlob } from "@/lib/utils";

interface Source {
  id: string;
  name: string;
  libDoc: PDFDocument;
}

interface PageItem {
  key: string;
  sourceId: string;
  pageIndex: number;
  rotation: number; // extra rotation added by the user
  thumb: string;
  label: string; // e.g. "doc.pdf p3"
}

// Distinct accent tints per source so merged pages are visually grouped.
const SOURCE_TINTS = ["#7c3aed", "#0ea5e9", "#f59e0b", "#ec4899", "#10b981"];

export default function PdfOrganizePage() {
  const tool = getTool("pdf-organize")!;
  const [sources, setSources] = React.useState<Source[]>([]);
  const [pages, setPages] = React.useState<PageItem[]>([]);
  const [ranges, setRanges] = React.useState("");
  const [outName, setOutName] = React.useState("organized");
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);
  const dragIndex = React.useRef<number | null>(null);

  const tintFor = React.useCallback(
    (sourceId: string) => SOURCE_TINTS[sources.findIndex((s) => s.id === sourceId) % SOURCE_TINTS.length],
    [sources]
  );

  async function addFiles(files: File[]) {
    setLoading(true);
    setError(null);
    try {
      const { PDFDocument } = await import("pdf-lib");
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const libDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const sourceId = crypto.randomUUID();
        const newSource: Source = { id: sourceId, name: file.name, libDoc };

        const viewDoc = await loadPdfDocument(buffer);
        const count = viewDoc.numPages;
        const newPages: PageItem[] = [];
        for (let p = 1; p <= count; p++) {
          const thumb = await renderThumbnail(viewDoc, p);
          newPages.push({
            key: crypto.randomUUID(),
            sourceId,
            pageIndex: p - 1,
            rotation: 0,
            thumb,
            label: `${file.name.replace(/\.pdf$/i, "")} · p${p}`,
          });
        }
        setSources((prev) => [...prev, newSource]);
        setPages((prev) => [...prev, ...newPages]);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't open that PDF (${e.message}). It may be password-protected.`
          : "Failed to open PDF."
      );
    } finally {
      setLoading(false);
    }
  }

  function rotatePage(key: string) {
    setPages((prev) =>
      prev.map((p) => (p.key === key ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
    );
  }
  function deletePage(key: string) {
    setPages((prev) => prev.filter((p) => p.key !== key));
  }
  function reorder(from: number, to: number) {
    setPages((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  }

  async function buildDoc(subset: PageItem[]): Promise<Blob> {
    const { PDFDocument, degrees } = await import("pdf-lib");
    const out = await PDFDocument.create();
    for (const item of subset) {
      const source = sources.find((s) => s.id === item.sourceId)!;
      const [copied] = await out.copyPages(source.libDoc, [item.pageIndex]);
      const current = copied.getRotation().angle;
      copied.setRotation(degrees((current + item.rotation) % 360));
      out.addPage(copied);
    }
    const bytes = await out.save();
    return new Blob([bytes as BlobPart], { type: "application/pdf" });
  }

  async function exportMerged() {
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    setProgress({ value: null, status: "Building PDF…" });
    try {
      const blob = await buildDoc(pages);
      downloadBlob(blob, buildFilename(outName, "pdf", "organized"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function parseRanges(input: string, max: number): number[][] {
    return input
      .split(",")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const m = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
          const a = Math.max(1, parseInt(m[1]));
          const b = Math.min(max, parseInt(m[2]));
          const arr = [];
          for (let i = a; i <= b; i++) arr.push(i - 1);
          return arr;
        }
        const single = parseInt(chunk);
        return Number.isFinite(single) && single >= 1 && single <= max ? [single - 1] : [];
      })
      .filter((arr) => arr.length);
  }

  async function exportSplit() {
    if (!pages.length) return;
    const groups = parseRanges(ranges, pages.length);
    if (!groups.length) {
      setError('Enter valid ranges over the current order, e.g. "1-3, 4, 5-8".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entries = [];
      for (let g = 0; g < groups.length; g++) {
        setProgress({ value: (g / groups.length) * 100, status: `Building part ${g + 1} of ${groups.length}…` });
        const subset = groups[g].map((idx) => pages[idx]);
        const blob = await buildDoc(subset);
        entries.push({ name: `${buildFilename(outName, "pdf", "part").replace(/\.pdf$/, "")}-part-${g + 1}.pdf`, blob });
      }
      if (entries.length === 1) {
        downloadBlob(entries[0].blob, buildFilename(`${outName}-split`, "pdf", "split"));
      } else {
        setProgress({ value: 100, status: "Zipping…" });
        downloadBlob(await zipBlobs(entries), buildFilename(`${outName}-split`, "zip", "split-pdfs"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function reset() {
    setSources([]);
    setPages([]);
    setError(null);
    setRanges("");
  }

  return (
    <ToolShell tool={tool}>
      <div className="space-y-6">
        <Dropzone
          accept=".pdf,application/pdf"
          multiple
          onFiles={addFiles}
          disabled={loading}
          title={pages.length ? "Add more PDFs to merge" : "Drop PDF(s) to organize"}
          hint="Merge multiple files, reorder & rotate pages, or split into ranges"
        />

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-accent" /> Rendering page thumbnails…
          </p>
        )}

        {error && <ErrorAlert message={error} />}

        {pages.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {pages.length} page{pages.length > 1 ? "s" : ""} from {sources.length} file
              {sources.length > 1 ? "s" : ""}. Drag to reorder; hover a page to rotate or remove.
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {pages.map((page, i) => (
                <div
                  key={page.key}
                  draggable
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null) reorder(dragIndex.current, i);
                    dragIndex.current = null;
                  }}
                  className="group relative overflow-hidden rounded-lg border border-border bg-card"
                  style={{ borderTopColor: tintFor(page.sourceId), borderTopWidth: 3 }}
                >
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-muted p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={page.thumb}
                      alt={page.label}
                      className="max-h-full max-w-full object-contain shadow-sm transition-transform"
                      style={{ transform: `rotate(${page.rotation}deg)` }}
                    />
                  </div>
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => rotatePage(page.key)}
                      className="rounded bg-black/40 p-1 text-white hover:bg-accent"
                      aria-label="Rotate page"
                    >
                      <RotateCw className="size-3.5" />
                    </button>
                    <span className="flex items-center gap-1 text-xs text-white">
                      <GripVertical className="size-3.5" />
                    </span>
                    <button
                      onClick={() => deletePage(page.key)}
                      className="rounded bg-black/40 p-1 text-white hover:bg-destructive"
                      aria-label="Remove page"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-xs font-medium">{i + 1}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{page.label}</span>
                  </div>
                </div>
              ))}
            </div>

            {progress && <ProgressBar value={progress.value} status={progress.status} />}

            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5">
              <FilenameField
                value={outName}
                onChange={setOutName}
                extension="pdf"
                className="w-44"
              />
              <Button onClick={exportMerged} disabled={busy}>
                <FileDown className="size-4" />
                Export as one PDF
              </Button>
              <div className="flex items-end gap-2">
                <div>
                  <Label htmlFor="ranges" className="mb-1.5 block text-sm">
                    Split ranges (over current order)
                  </Label>
                  <Input
                    id="ranges"
                    placeholder="e.g. 1-3, 4, 5-8"
                    value={ranges}
                    onChange={(e) => setRanges(e.target.value)}
                    className="w-48"
                  />
                </div>
                <Button variant="secondary" onClick={exportSplit} disabled={busy}>
                  <Scissors className="size-4" />
                  Split
                </Button>
              </div>
            </div>

            <Button variant="ghost" onClick={reset} disabled={busy}>
              <RefreshCw className="size-4" />
              Start over
            </Button>
          </>
        )}
      </div>
    </ToolShell>
  );
}
