"use client";

import * as React from "react";
import { ScanText, RefreshCw, Package, Copy, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { recognizeText, OCR_LANGUAGES, type OcrLanguage } from "@/lib/ocr";
import { loadPdfDocument, renderPageToCanvas } from "@/lib/pdf";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { zipBlobs } from "@/lib/zip";
import { cn, downloadBlob, withExtension } from "@/lib/utils";

interface OcrPage {
  fileIndex: number;
  fileName: string;
  pageNumber: number;
  pageCount: number;
  text: string;
}

const PDF_SCALE = 2.2; // higher render resolution improves OCR accuracy

export default function OcrPage() {
  const tool = getTool("ocr")!;
  const [files, setFiles] = React.useState<File[]>([]);
  const [lang, setLang] = React.useState<OcrLanguage>("eng");
  const [outName, setOutName] = React.useState("extracted-text");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [pages, setPages] = React.useState<OcrPage[]>([]);
  const [current, setCurrent] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setPages([]);
    setCurrent(0);
    try {
      const out: OcrPage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const baseProgress = (i / files.length) * 100;
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

        if (isPdf) {
          const buffer = await file.arrayBuffer();
          const doc = await loadPdfDocument(buffer);
          for (let p = 1; p <= doc.numPages; p++) {
            setProgress({
              value: baseProgress + ((p - 1) / doc.numPages / files.length) * 100,
              status: `OCR on ${file.name} — page ${p} of ${doc.numPages}…`,
            });
            const canvas = await renderPageToCanvas(doc, p, PDF_SCALE);
            const { text } = await recognizeText(canvas, lang, (ratio) =>
              setProgress({
                value:
                  baseProgress +
                  ((p - 1 + ratio) / doc.numPages / files.length) * 100,
                status: `OCR on ${file.name} — page ${p} of ${doc.numPages}…`,
              })
            );
            out.push({
              fileIndex: i,
              fileName: file.name,
              pageNumber: p,
              pageCount: doc.numPages,
              text: text.trim(),
            });
          }
        } else {
          setProgress({ value: baseProgress, status: `OCR on ${file.name}…` });
          const { text } = await recognizeText(file, lang, (ratio) =>
            setProgress({
              value: baseProgress + (ratio / files.length) * 100,
              status: `OCR on ${file.name}…`,
            })
          );
          out.push({
            fileIndex: i,
            fileName: file.name,
            pageNumber: 1,
            pageCount: 1,
            text: text.trim(),
          });
        }
      }
      setPages(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  React.useEffect(() => {
    if (pages.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(pages.length - 1, c + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  const page = pages[current];
  const multiFile = new Set(pages.map((p) => p.fileIndex)).size > 1;
  const caption = page
    ? page.pageCount > 1
      ? `${multiFile ? `${page.fileName} — ` : ""}Page ${page.pageNumber} of ${page.pageCount}`
      : page.fileName
    : "";

  async function downloadAll() {
    const byFile = new Map<number, OcrPage[]>();
    for (const p of pages) {
      if (!byFile.has(p.fileIndex)) byFile.set(p.fileIndex, []);
      byFile.get(p.fileIndex)!.push(p);
    }
    const entries = Array.from(byFile.values()).map((filePages) => ({
      name: withExtension(filePages[0].fileName, "txt"),
      blob: new Blob([filePages.map((p) => p.text).join("\n\n----- Page Break -----\n\n")], {
        type: "text/plain",
      }),
    }));
    if (entries.length === 1) {
      downloadBlob(entries[0].blob, buildFilename(outName, "txt", "extracted"));
    } else {
      const zip = await zipBlobs(entries);
      downloadBlob(zip, buildFilename(outName, "zip", "extracted-text"));
    }
  }

  async function copyCurrent() {
    if (!page) return;
    await navigator.clipboard.writeText(page.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <ToolShell tool={tool}>
      {files.length === 0 ? (
        <Dropzone
          accept="image/*,.pdf,application/pdf"
          multiple
          onFiles={(f) => {
            setFiles(f);
            setPages([]);
            setCurrent(0);
            setOutName(f.length === 1 ? sanitizeBaseName(f[0].name) : "extracted-text");
          }}
          title="Drop image(s) or PDF(s) to extract text"
          hint="Scanned PDFs, photos of documents, screenshots — anything with readable text"
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Language</Label>
              <Select value={lang} onChange={(e) => setLang(e.target.value as OcrLanguage)}>
                {OCR_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={run} disabled={busy} className="w-full sm:w-auto">
                <ScanText className="size-4" />
                Extract text from {files.length > 1 ? `all ${files.length} files` : "file"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                First run downloads the OCR language model (~2–15 MB) — cached after that.
              </p>
            </div>
          </div>

          {progress && <ProgressBar value={progress.value} status={progress.status} />}
          {error && <ErrorAlert message={error} />}

          {pages.length > 0 && page && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <FilenameField
                  value={outName}
                  onChange={setOutName}
                  extension={new Set(pages.map((p) => p.fileIndex)).size > 1 ? "zip" : "txt"}
                  label="Output file name"
                  className="w-full max-w-xs"
                />
                {pages.length > 1 && (
                  <Button size="sm" variant="secondary" onClick={downloadAll}>
                    <Package className="size-4" />
                    Download all
                  </Button>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="truncate font-medium">{page.fileName}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={copyCurrent}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        downloadBlob(
                          new Blob([page.text], { type: "text/plain" }),
                          page.pageCount > 1
                            ? withExtension(`${page.fileName}-p${page.pageNumber}`, "txt")
                            : buildFilename(outName, "txt", "extracted")
                        )
                      }
                    >
                      Download
                    </Button>
                  </div>
                </div>
                <textarea
                  key={current}
                  readOnly
                  value={page.text || "(No text detected.)"}
                  rows={14}
                  className="w-full resize-y rounded-md border border-input bg-muted/40 p-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                {pages.length > 1 && (
                  <div className="flex items-center justify-center gap-4 pt-1">
                    <button
                      type="button"
                      onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                      disabled={current === 0}
                      aria-label="Previous page"
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                      )}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-0 truncate text-sm text-muted-foreground">{caption}</span>
                    <button
                      type="button"
                      onClick={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))}
                      disabled={current === pages.length - 1}
                      aria-label="Next page"
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                      )}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            onClick={() => {
              setFiles([]);
              setPages([]);
              setCurrent(0);
              setError(null);
            }}
            disabled={busy}
          >
            <RefreshCw className="size-4" />
            Start over
          </Button>
        </div>
      )}
    </ToolShell>
  );
}
