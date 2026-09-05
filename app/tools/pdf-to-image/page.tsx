"use client";

import * as React from "react";
import { FileDown, RefreshCw, Package, Download } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { TargetSizeField } from "@/components/shared/target-size-field";
import { AlertDialog } from "@/components/shared/alert-dialog";
import {
  loadPdfDocument,
  parsePageSelection,
  renderPageToCanvas,
  stitchCanvasesVertically,
} from "@/lib/pdf";
import {
  canvasToBlob,
  compressCanvasToTargetBytes,
  LOSSY_FORMATS,
  type ImageFormat,
} from "@/lib/image";
import { zipBlobs } from "@/lib/zip";
import { downloadBlob, formatBytes } from "@/lib/utils";

const RENDER_SCALE = 2;
const DEFAULT_QUALITY = 0.92;
const PREVIEW_COUNT = 8;

type ExportFormat = Extract<ImageFormat, "png" | "jpeg" | "webp">;

interface PageResult {
  page: number;
  blob: Blob;
  name: string;
  quality?: number;
  scale?: number;
}

export default function PdfToImagePage() {
  const tool = getTool("pdf-to-image")!;

  const [file, setFile] = React.useState<File | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [pagesInput, setPagesInput] = React.useState("");
  const [merge, setMerge] = React.useState(false);
  const [format, setFormat] = React.useState<ExportFormat>("jpeg");
  const [targetMode, setTargetMode] = React.useState(false);
  const [targetKB, setTargetKB] = React.useState<number | null>(500);
  const [outName, setOutName] = React.useState("pages");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);
  const [invalidAlert, setInvalidAlert] = React.useState(false);
  const [results, setResults] = React.useState<PageResult[]>([]);
  const [merged, setMerged] = React.useState<PageResult | null>(null);
  const [previews, setPreviews] = React.useState<string[]>([]);
  const [overshot, setOvershot] = React.useState(false);

  const previewsRef = React.useRef<string[]>([]);
  React.useEffect(
    () => () => {
      previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  function releasePreviews() {
    previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
    previewsRef.current = [];
    setPreviews([]);
  }

  async function onFile(f: File) {
    releasePreviews();
    setFile(f);
    setResults([]);
    setMerged(null);
    setError(null);
    setOvershot(false);
    setPagesInput("");
    setOutName(sanitizeBaseName(f.name) || "pages");
    try {
      const doc = await loadPdfDocument(await f.arrayBuffer());
      setPageCount(doc.numPages);
    } catch (e) {
      setFile(null);
      setPageCount(0);
      setError(
        e instanceof Error
          ? `Couldn't open that PDF (${e.message}). It may be password-protected.`
          : "Failed to open PDF."
      );
    }
  }

  const selectedPages = pageCount ? parsePageSelection(pagesInput, pageCount) : [];
  const pagesHint =
    !pagesInput.trim() && pageCount
      ? `All ${pageCount} page${pageCount === 1 ? "" : "s"}`
      : selectedPages.length
        ? `${selectedPages.length} page${selectedPages.length === 1 ? "" : "s"}: ${selectedPages.join(", ")}`
        : pageCount
          ? `Enter pages between 1 and ${pageCount}, e.g. 1-3, 5, 6`
          : "";

  const encodeFormat: ExportFormat = targetMode && format === "png" ? "jpeg" : format;
  const invalidTarget = targetMode && (targetKB === null || targetKB < 10);
  const outExt = merge || selectedPages.length <= 1 ? encodeFormat : "zip";

  async function encodeCanvas(
    canvas: HTMLCanvasElement,
    label: string,
    value: number | null
  ): Promise<{ blob: Blob; quality?: number; scale?: number; met: boolean }> {
    if (targetMode) {
      const target = targetKB as number;
      const fmt = encodeFormat as Extract<ImageFormat, "jpeg" | "webp">;
      const { blob, quality, scale } = await compressCanvasToTargetBytes(canvas, target * 1024, fmt, {
        onProgress: (info) => setProgress({ value, status: `${label} · ${info}` }),
      });
      return { blob, quality, scale, met: blob.size <= target * 1024 };
    }
    const q = LOSSY_FORMATS.includes(encodeFormat) ? DEFAULT_QUALITY : undefined;
    return { blob: await canvasToBlob(canvas, encodeFormat, q), met: true };
  }

  async function run() {
    if (!file || !pageCount) return;
    if (pagesInput.trim() && !selectedPages.length) {
      setError(`Enter valid pages between 1 and ${pageCount}, e.g. "1-3, 5, 6". Leave blank for all.`);
      return;
    }
    if (invalidTarget) {
      setInvalidAlert(true);
      return;
    }

    setBusy(true);
    setError(null);
    setResults([]);
    setMerged(null);
    setOvershot(false);
    releasePreviews();

    try {
      const doc = await loadPdfDocument(await file.arrayBuffer());
      const pages = selectedPages.length ? selectedPages : parsePageSelection("", pageCount);
      const canvases: HTMLCanvasElement[] = [];

      for (let i = 0; i < pages.length; i++) {
        setProgress({
          value: (i / pages.length) * 70,
          status: `Rendering page ${pages[i]} (${i + 1} of ${pages.length})…`,
        });
        canvases.push(await renderPageToCanvas(doc, pages[i], RENDER_SCALE));
      }

      const base = sanitizeBaseName(outName) || "pages";
      const pad = String(Math.max(...pages, pages.length)).length;
      const nextPreviews: string[] = [];
      let anyOvershot = false;

      if (merge) {
        setProgress({ value: 80, status: "Stitching pages into one image…" });
        const strip = stitchCanvasesVertically(canvases);
        const encoded = await encodeCanvas(strip, "Long image", 90);
        anyOvershot = !encoded.met;
        const name = `${base}.${encodeFormat}`;
        setMerged({ page: 0, blob: encoded.blob, name, quality: encoded.quality, scale: encoded.scale });
        nextPreviews.push(URL.createObjectURL(encoded.blob));
      } else {
        const out: PageResult[] = [];
        for (let i = 0; i < canvases.length; i++) {
          setProgress({
            value: 70 + (i / canvases.length) * 25,
            status: `Encoding page ${pages[i]} (${i + 1} of ${canvases.length})…`,
          });
          const encoded = await encodeCanvas(
            canvases[i],
            `Page ${pages[i]}`,
            70 + (i / canvases.length) * 25
          );
          if (!encoded.met) anyOvershot = true;
          const name = `${base}-p${String(pages[i]).padStart(pad, "0")}.${encodeFormat}`;
          out.push({ page: pages[i], blob: encoded.blob, name, quality: encoded.quality, scale: encoded.scale });
          if (nextPreviews.length < PREVIEW_COUNT) nextPreviews.push(URL.createObjectURL(encoded.blob));
        }
        setResults(out);
      }

      previewsRef.current = nextPreviews;
      setPreviews(nextPreviews);
      setOvershot(anyOvershot);
      setProgress({ value: 100, status: "Done" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not convert this PDF.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function downloadResults() {
    if (merged) {
      downloadBlob(merged.blob, buildFilename(outName, encodeFormat, "pdf-pages"));
      return;
    }
    if (results.length === 1) {
      downloadBlob(results[0].blob, buildFilename(outName, encodeFormat, "pdf-page"));
      return;
    }
    const zip = await zipBlobs(results.map((r) => ({ name: r.name, blob: r.blob })));
    downloadBlob(zip, buildFilename(outName, "zip", "pdf-pages"));
  }

  function reset() {
    releasePreviews();
    setFile(null);
    setPageCount(0);
    setPagesInput("");
    setResults([]);
    setMerged(null);
    setError(null);
    setOvershot(false);
  }

  const resultCount = merged ? 1 : results.length;
  const resultBytes = merged
    ? merged.blob.size
    : results.reduce((s, r) => s + r.blob.size, 0);

  return (
    <ToolShell tool={tool}>
      {!file ? (
        <Dropzone
          accept=".pdf,application/pdf"
          warnSizeMB={50}
          onFiles={(f) => onFile(f[0])}
          title="Drop a PDF to export as images"
          hint="All pages by default, or pick ranges like 1-3, 5, 6"
        />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {pageCount} page{pageCount === 1 ? "" : "s"} · {formatBytes(file.size)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="pages" className="mb-1.5 block">
                  Pages
                </Label>
                <Input
                  id="pages"
                  value={pagesInput}
                  onChange={(e) => setPagesInput(e.target.value)}
                  placeholder="Leave blank for all, or e.g. 1-3, 5, 6"
                />
                <p className="mt-1 text-xs text-muted-foreground">{pagesHint}</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3 sm:col-span-2">
                <div>
                  <Label htmlFor="merge">Stitch into one long image</Label>
                  <p className="text-xs text-muted-foreground">
                    Stack selected pages top-to-bottom as a single strip.
                  </p>
                </div>
                <Switch id="merge" checked={merge} onCheckedChange={setMerge} />
              </div>

              <div>
                <Label htmlFor="fmt" className="mb-1.5 block">
                  Format
                </Label>
                <Select
                  id="fmt"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                >
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </Select>
                {targetMode && format === "png" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Size targeting uses JPEG — PNG has no quality slider.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                <div>
                  <Label htmlFor="target-mode">Limit output size</Label>
                  <p className="text-xs text-muted-foreground">
                    {merge ? "Applies to the stitched image." : "Applies to each page image."}
                  </p>
                </div>
                <Switch
                  id="target-mode"
                  checked={targetMode}
                  onCheckedChange={(on) => {
                    setTargetMode(on);
                    if (on && format === "png") setFormat("jpeg");
                  }}
                />
              </div>

              {targetMode && (
                <TargetSizeField
                  id="target-kb"
                  label="Target size (KB)"
                  value={targetKB ?? 500}
                  onChange={setTargetKB}
                  min={10}
                  resetKey={file.name + file.size}
                  hint={
                    merge
                      ? "The long image will be compressed toward this size."
                      : "Each page image will be compressed toward this size."
                  }
                />
              )}

              <FilenameField
                value={outName}
                onChange={setOutName}
                extension={outExt}
                className={targetMode ? "" : "sm:col-span-2"}
              />
            </div>

            <Button onClick={run} disabled={busy} className="mt-4">
              <FileDown className="size-4" />
              {merge ? "Create long image" : "Export images"}
            </Button>
          </div>

          {progress && <ProgressBar value={progress.value} status={progress.status} />}
          {error && <ErrorAlert message={error} />}

          {resultCount > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 font-semibold">Result</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                {merged
                  ? `1 long image · ${formatBytes(resultBytes)}`
                  : `${results.length} image${results.length === 1 ? "" : "s"} · ${formatBytes(resultBytes)}${
                      results.length > 1 ? " (ZIP)" : ""
                    }`}
                {targetMode && overshot
                  ? ` · couldn't fully reach ${targetKB} KB at a legible quality`
                  : targetMode
                    ? ` · under ${targetKB} KB${merge || results.length === 1 ? "" : " per page"}`
                    : ""}
              </p>

              <div
                className={
                  merge
                    ? "max-h-[480px] overflow-auto rounded-lg border border-border bg-muted"
                    : "grid grid-cols-2 gap-2 sm:grid-cols-4"
                }
              >
                {previews.map((src, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={src}
                    src={src}
                    alt={merge ? "Stitched pages" : `Page preview ${i + 1}`}
                    className={
                      merge
                        ? "mx-auto w-full max-w-md bg-white object-contain"
                        : "aspect-[3/4] w-full rounded-lg bg-muted object-contain"
                    }
                  />
                ))}
              </div>
              {!merge && results.length > previews.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the first {previews.length} pages — all {results.length} are in the download.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={downloadResults}>
                  {resultCount > 1 ? <Package className="size-4" /> : <Download className="size-4" />}
                  {resultCount > 1
                    ? `Download ZIP (${formatBytes(resultBytes)})`
                    : `Download ${encodeFormat.toUpperCase()} (${formatBytes(resultBytes)})`}
                </Button>
              </div>
            </div>
          )}

          <Button variant="ghost" onClick={reset} disabled={busy}>
            <RefreshCw className="size-4" />
            Choose a different file
          </Button>
        </div>
      )}

      {invalidAlert && (
        <AlertDialog
          title="Fix the target size first"
          message="Enter a target size of at least 10 KB before exporting."
          onClose={() => setInvalidAlert(false)}
        />
      )}
    </ToolShell>
  );
}
