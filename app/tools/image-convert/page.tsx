"use client";

import * as React from "react";
import { Repeat, RefreshCw, Package } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  loadImageFromBlob,
  canvasToBlob,
  canEncode,
  LOSSY_FORMATS,
  FORMAT_MIME,
  type ImageFormat,
} from "@/lib/image";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { zipBlobs } from "@/lib/zip";
import { downloadBlob, formatBytes, withExtension } from "@/lib/utils";

interface Result {
  name: string;
  originalSize: number;
  blob: Blob;
}

export default function ImageConvertPage() {
  const tool = getTool("image-convert")!;
  const [files, setFiles] = React.useState<File[]>([]);
  const [format, setFormat] = React.useState<ImageFormat>("webp");
  const [quality, setQuality] = React.useState(0.9);
  const [background, setBackground] = React.useState("#ffffff");
  const [outName, setOutName] = React.useState("converted-images");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [results, setResults] = React.useState<Result[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      if (!(await canEncode(format))) {
        setError(`Your browser can't encode ${format.toUpperCase()}. Try WebP, JPEG or PNG.`);
        return;
      }
      const out: Result[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ value: (i / files.length) * 100, status: `Converting ${i + 1} of ${files.length}: ${file.name}` });
        const img = await loadImageFromBlob(file);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        if (format === "jpeg") {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        const blob = await canvasToBlob(canvas, format, LOSSY_FORMATS.includes(format) ? quality : undefined);
        if (blob.type !== FORMAT_MIME[format]) {
          setError(`Encoding to ${format.toUpperCase()} isn't supported here.`);
          return;
        }
        out.push({ name: withExtension(file.name, format), originalSize: file.size, blob });
      }
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function downloadAll() {
    const zip = await zipBlobs(results.map((r) => ({ name: r.name, blob: r.blob })));
    downloadBlob(zip, buildFilename(outName, "zip", "converted-images"));
  }

  return (
    <ToolShell tool={tool}>
      {files.length === 0 ? (
        <Dropzone
          accept="image/*"
          multiple
          onFiles={(f) => {
            setFiles(f);
            setResults([]);
            setOutName(f.length === 1 ? sanitizeBaseName(f[0].name) : "converted-images");
          }}
          title="Drop image(s) to convert"
          hint="Batch convert between PNG, JPEG, WebP & AVIF"
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Convert to</Label>
              <Select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
                <option value="webp">WebP</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="avif">AVIF</option>
              </Select>
            </div>
            {format === "jpeg" && (
              <div>
                <Label className="mb-1.5 block">Background (for transparency)</Label>
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded-md border border-input bg-card"
                  aria-label="JPEG background color"
                />
              </div>
            )}
            {LOSSY_FORMATS.includes(format) && (
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block">Quality — {Math.round(quality * 100)}%</Label>
                <Slider value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button onClick={run} disabled={busy} className="w-full sm:w-auto">
                <Repeat className="size-4" />
                Convert {files.length > 1 ? `all ${files.length}` : ""} to {format.toUpperCase()}
              </Button>
            </div>
          </div>

          {progress && <ProgressBar value={progress.value} status={progress.status} />}
          {error && <ErrorAlert message={error} />}

          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <FilenameField
                  value={outName}
                  onChange={setOutName}
                  extension={results.length > 1 ? "zip" : format}
                  label={results.length > 1 ? "ZIP file name" : "Output file name"}
                  className="w-full max-w-xs"
                />
                {results.length > 1 && (
                  <Button size="sm" variant="secondary" onClick={downloadAll}>
                    <Package className="size-4" />
                    Download all as ZIP
                  </Button>
                )}
              </div>
              {results.map((r, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatBytes(r.originalSize)} → {formatBytes(r.blob.size)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      downloadBlob(r.blob, results.length === 1 ? buildFilename(outName, format, "converted") : r.name)
                    }
                  >
                    Download
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button variant="ghost" onClick={() => { setFiles([]); setResults([]); setError(null); }} disabled={busy}>
            <RefreshCw className="size-4" />
            Start over
          </Button>
        </div>
      )}
    </ToolShell>
  );
}
