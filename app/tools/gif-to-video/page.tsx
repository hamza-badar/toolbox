"use client";

import * as React from "react";
import { Video, Download, RefreshCw } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useFFmpeg } from "@/components/shared/use-ffmpeg";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { fetchFileData, safeName } from "@/lib/ffmpeg";
import { downloadBlob, formatBytes } from "@/lib/utils";

export default function GifToVideoPage() {
  const tool = getTool("gif-to-video")!;
  const { ensure, loaded, loadRatio, jobRatio } = useFFmpeg();

  const [file, setFile] = React.useState<File | null>(null);
  const [format, setFormat] = React.useState<"mp4" | "webm">("mp4");
  const [loops, setLoops] = React.useState(0); // 0 = play once (no extra loops)
  const [fpsOverride, setFpsOverride] = React.useState(0); // 0 = keep source
  const [outName, setOutName] = React.useState("video");

  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "processing">("idle");
  const [result, setResult] = React.useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPhase(loaded ? "processing" : "loading");
      const ff = await ensure();
      setPhase("processing");

      const inName = safeName(file.name, "gif");
      await ff.writeFile(inName, await fetchFileData(file));

      const outName = `out.${format}`;
      const vf = [
        fpsOverride > 0 ? `fps=${fpsOverride}` : "",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2", // even dims required by yuv420p
      ]
        .filter(Boolean)
        .join(",");

      const pre = loops > 0 ? ["-stream_loop", String(loops)] : [];
      const args =
        format === "mp4"
          ? [...pre, "-i", inName, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-vf", vf, "-c:v", "libx264", "-crf", "23", "-y", outName]
          : [...pre, "-i", inName, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-deadline", "good", "-cpu-used", "5", "-vf", vf, "-y", outName];

      await ff.exec(args);
      const data = await ff.readFile(outName);
      const blob = new Blob([data as BlobPart], {
        type: format === "mp4" ? "video/mp4" : "video/webm",
      });
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed.");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  const progressValue = phase === "loading" ? loadRatio * 100 : jobRatio > 0 ? jobRatio * 100 : null;

  return (
    <ToolShell tool={tool}>
      {!file ? (
        <Dropzone
          accept="image/gif,.gif"
          warnSizeMB={100}
          onFiles={(f) => {
            setFile(f[0]);
            setResult(null);
            setError(null);
            setOutName(sanitizeBaseName(f[0].name) || "video");
          }}
          title="Drop a GIF to convert to video"
          hint="Outputs compact MP4 (H.264) or WebM (VP9)"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-sm text-muted-foreground">
                {file.name} · {formatBytes(file.size)}
              </p>
              {result ? (
                <video src={result.url} controls autoPlay loop className="w-full rounded-lg bg-black" />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Your converted video will appear here.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Output format</Label>
              <Select value={format} onChange={(e) => setFormat(e.target.value as "mp4" | "webm")}>
                <option value="mp4">MP4 (H.264, most compatible)</option>
                <option value="webm">WebM (VP9, smaller)</option>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Extra loops (repeat)</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={loops}
                onChange={(e) => setLoops(Math.max(0, Number(e.target.value)))}
              />
              <p className="mt-1 text-xs text-muted-foreground">0 = play the GIF content once.</p>
            </div>
            <div>
              <Label className="mb-1.5 block">Frame-rate override</Label>
              <Select value={fpsOverride} onChange={(e) => setFpsOverride(Number(e.target.value))}>
                <option value={0}>Keep source</option>
                {[10, 15, 24, 30, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </Select>
            </div>

            {busy && (
              <ProgressBar
                value={progressValue}
                status={phase === "loading" ? "Loading video engine (one-time)…" : "Encoding video…"}
              />
            )}
            {error && <ErrorAlert message={error} />}

            <FilenameField value={outName} onChange={setOutName} extension={format} />

            <div className="flex flex-col gap-2">
              <Button onClick={run} disabled={busy}>
                <Video className="size-4" />
                Convert to {format.toUpperCase()}
              </Button>
              {result && (
                <Button
                  variant="secondary"
                  onClick={() => downloadBlob(result.blob, buildFilename(outName, format, "video"))}
                >
                  <Download className="size-4" />
                  Download ({formatBytes(result.blob.size)})
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setResult(null);
                }}
                disabled={busy}
              >
                <RefreshCw className="size-4" />
                Choose another GIF
              </Button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
}
