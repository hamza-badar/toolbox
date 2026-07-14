"use client";

import * as React from "react";
import { Minimize2, RefreshCw, Package } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { TargetSizeField } from "@/components/shared/target-size-field";
import { AlertDialog } from "@/components/shared/alert-dialog";
import { loadImageFromBlob, compressToTargetBytes } from "@/lib/image";
import { zipBlobs } from "@/lib/zip";
import { downloadBlob, formatBytes, withExtension } from "@/lib/utils";

interface Result {
  name: string;
  originalSize: number;
  blob: Blob;
  quality: number;
  scale: number;
}

export default function ImageCompressPage() {
  const tool = getTool("image-compress")!;
  const [files, setFiles] = React.useState<File[]>([]);
  const [targetKB, setTargetKB] = React.useState<number | null>(200);
  const [format, setFormat] = React.useState<"jpeg" | "webp">("jpeg");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [results, setResults] = React.useState<Result[]>([]);
  const [outName, setOutName] = React.useState("compressed-images");
  const [error, setError] = React.useState<string | null>(null);
  const [invalidAlert, setInvalidAlert] = React.useState(false);

  const smallest = files.length ? Math.min(...files.map((f) => f.size)) : 0;
  const maxKB = smallest ? Math.max(10, Math.floor(smallest / 1024) - 1) : 10;
  const invalidTarget = targetKB === null || targetKB < 10 || targetKB * 1024 >= smallest;

  async function run() {
    if (invalidTarget) {
      setInvalidAlert(true);
      return;
    }
    const target = targetKB as number;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const out: Result[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({
          value: (i / files.length) * 100,
          status: `Compressing ${i + 1} of ${files.length}: ${file.name}`,
        });
        const img = await loadImageFromBlob(file);
        const { blob, quality, scale } = await compressToTargetBytes(
          img,
          target * 1024,
          format,
          { onProgress: (info) => setProgress({ value: (i / files.length) * 100, status: `${file.name} · ${info}` }) }
        );
        out.push({ name: withExtension(file.name, format), originalSize: file.size, blob, quality, scale });
      }
      setResults(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compression failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function downloadAll() {
    const zip = await zipBlobs(results.map((r) => ({ name: r.name, blob: r.blob })));
    downloadBlob(zip, buildFilename(outName, "zip", "compressed-images"));
  }

  function reset() {
    setFiles([]);
    setResults([]);
    setError(null);
  }

  return (
    <ToolShell tool={tool}>
      {files.length === 0 ? (
        <Dropzone
          accept="image/*"
          multiple
          warnSizeMB={40}
          onFiles={(f) => {
            setFiles(f);
            setResults([]);
            // sensible default target: ~60% of the smallest file
            const min = Math.min(...f.map((x) => x.size));
            setTargetKB(Math.max(20, Math.round((min * 0.6) / 1024)));
            setOutName(f.length === 1 ? `${sanitizeBaseName(f[0].name)}-min` : "compressed-images");
          }}
          title="Drop image(s) to compress"
          hint="JPEG, PNG, WebP · compresses toward a target size"
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <TargetSizeField
              id="target"
              label="Target size (KB)"
              value={targetKB ?? 200}
              onChange={setTargetKB}
              min={10}
              max={maxKB}
              resetKey={files.map((f) => `${f.name}:${f.size}`).join(",")}
              hint={`Smallest input is ${formatBytes(smallest)}. Target must be below that.`}
            />
            <div>
              <Label htmlFor="fmt" className="mb-1.5 block">
                Output format
              </Label>
              <Select id="fmt" value={format} onChange={(e) => setFormat(e.target.value as "jpeg" | "webp")}>
                <option value="jpeg">JPEG (best compatibility)</option>
                <option value="webp">WebP (smaller files)</option>
              </Select>
            </div>
            <Button onClick={run} disabled={busy}>
              <Minimize2 className="size-4" />
              Compress {files.length > 1 ? `all ${files.length}` : ""}
            </Button>
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
              {results.map((r, i) => {
                const saved = 1 - r.blob.size / r.originalSize;
                const overshot = r.blob.size > (targetKB ?? 0) * 1024;
                return (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatBytes(r.originalSize)} → {formatBytes(r.blob.size)} ·{" "}
                        <span className={saved > 0 ? "text-success" : "text-warning"}>
                          {saved > 0 ? `${Math.round(saved * 100)}% smaller` : "no reduction"}
                        </span>
                        {r.scale < 1 && ` · downscaled to ${Math.round(r.scale * 100)}%`}
                        {overshot && " · target could not be fully met"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        downloadBlob(r.blob, results.length === 1 ? buildFilename(outName, format, "compressed") : r.name)
                      }
                    >
                      Download
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <Button variant="ghost" onClick={reset} disabled={busy}>
            <RefreshCw className="size-4" />
            Start over
          </Button>
        </div>
      )}
      {invalidAlert && (
        <AlertDialog
          title="Fix the target size first"
          message={`Enter a target size between 10 KB and ${formatBytes(smallest)} before compressing.`}
          onClose={() => setInvalidAlert(false)}
        />
      )}
    </ToolShell>
  );
}
