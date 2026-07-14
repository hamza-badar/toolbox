"use client";

import * as React from "react";
import { FileDown, RefreshCw, AlertTriangle } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { TargetSizeField } from "@/components/shared/target-size-field";
import { AlertDialog } from "@/components/shared/alert-dialog";
import { compressPdfToTarget, type CompressResult, type PdfMode } from "@/lib/pdf";
import { downloadBlob, formatBytes } from "@/lib/utils";

export default function PdfCompressPage() {
  const tool = getTool("pdf-compress")!;
  const [file, setFile] = React.useState<File | null>(null);
  const [targetKB, setTargetKB] = React.useState<number | null>(500);
  const [scanned, setScanned] = React.useState(true);
  const [outName, setOutName] = React.useState("compressed");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );
  const [result, setResult] = React.useState<CompressResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [invalidAlert, setInvalidAlert] = React.useState(false);

  const mode: PdfMode = scanned ? "scanned" : "text";
  const maxKB = file ? Math.max(10, Math.floor(file.size / 1024) - 1) : 10;
  const invalidTarget = !file || targetKB === null || targetKB < 10 || targetKB * 1024 >= file.size;

  async function run() {
    if (!file) return;
    if (invalidTarget) {
      setInvalidAlert(true);
      return;
    }
    const target = targetKB as number;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await compressPdfToTarget(file, target * 1024, {
        mode,
        onProgress: (value, status) => setProgress({ value, status }),
      });
      setResult(res);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not compress this PDF. It may be encrypted or corrupted."
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <ToolShell tool={tool}>
      {!file ? (
        <Dropzone
          accept=".pdf,application/pdf"
          warnSizeMB={50}
          onFiles={(f) => {
            setFile(f[0]);
            setResult(null);
            setError(null);
            setTargetKB(Math.max(50, Math.round((f[0].size * 0.5) / 1024)));
            setInvalidAlert(false);
            setOutName(`${sanitizeBaseName(f[0].name)}-compressed`);
          }}
          title="Drop a PDF to compress"
          hint="Rasterizes pages to hit your target size"
        />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">Original: {formatBytes(file.size)}</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TargetSizeField
                id="target"
                label="Target size (KB)"
                value={targetKB ?? 500}
                onChange={setTargetKB}
                min={10}
                max={maxKB}
                resetKey={file.name + file.size}
                hint={`Smallest is 10 KB, largest below ${formatBytes(file.size)}.`}
              />

              <div className="flex flex-col justify-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="scanned" className="text-sm">
                    Image-heavy / scanned PDF
                  </Label>
                  <Switch id="scanned" checked={scanned} onCheckedChange={setScanned} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {scanned
                    ? "Rasterizes aggressively — best for scans & image-heavy documents."
                    : "Text mode: keeps a higher resolution floor for legibility."}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span className="text-foreground/80">
                Compression rasterizes each page to an image, so{" "}
                <strong>text becomes non-selectable and non-searchable</strong>. Great for scans;
                use sparingly on text documents.
              </span>
            </div>

            <Button onClick={run} disabled={busy} className="mt-4">
              <FileDown className="size-4" />
              Compress PDF
            </Button>
          </div>

          {progress && <ProgressBar value={progress.value} status={progress.status} />}
          {error && <ErrorAlert message={error} />}

          {result && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 font-semibold">Result</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Original" value={formatBytes(file.size)} />
                <Stat label="Compressed" value={formatBytes(result.achievedBytes)} accent />
                <Stat label="Target" value={`${targetKB} KB`} />
                <Stat
                  label="Reduction"
                  value={`${Math.round((1 - result.achievedBytes / file.size) * 100)}%`}
                />
              </div>

              {result.achievedBytes > (targetKB ?? 0) * 1024 ? (
                <p className="mt-3 text-sm text-warning">
                  Couldn&apos;t reach the target without destroying quality (hit the resolution
                  floor). This is the smallest legible result. Try a higher target or scanned mode.
                </p>
              ) : (
                <p className="mt-3 text-sm text-success">
                  Reached target at {Math.round(result.quality * 100)}% JPEG quality,{" "}
                  {Math.round(result.scale * 100)}% render scale.
                </p>
              )}

              <FilenameField
                value={outName}
                onChange={setOutName}
                extension="pdf"
                className="mt-4 max-w-sm"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => downloadBlob(result.blob, buildFilename(outName, "pdf", "compressed"))}>
                  <FileDown className="size-4" />
                  Download compressed PDF
                </Button>
                <Button variant="secondary" onClick={run} disabled={busy}>
                  <RefreshCw className="size-4" />
                  Re-run with current target
                </Button>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            onClick={() => {
              setFile(null);
              setResult(null);
              setError(null);
            }}
            disabled={busy}
          >
            <RefreshCw className="size-4" />
            Choose a different file
          </Button>
        </div>
      )}
      {invalidAlert && (
        <AlertDialog
          title="Fix the target size first"
          message={`Enter a target size between 10 KB and ${file ? formatBytes(file.size) : "the file size"} before compressing.`}
          onClose={() => setInvalidAlert(false)}
        />
      )}
    </ToolShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-semibold ${accent ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}
