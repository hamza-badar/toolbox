"use client";

import * as React from "react";
import { Film, Download, RefreshCw } from "lucide-react";
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
import { useFFmpeg } from "@/components/shared/use-ffmpeg";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { fetchFileData, safeName } from "@/lib/ffmpeg";
import { downloadBlob, formatBytes, clamp } from "@/lib/utils";

export default function VideoToGifPage() {
  const tool = getTool("video-to-gif")!;
  const { ensure, loaded, loadRatio, jobRatio } = useFFmpeg();

  const [file, setFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState(0);

  const [start, setStart] = React.useState(0);
  const [clipLen, setClipLen] = React.useState(3);
  const [width, setWidth] = React.useState(480);
  const [fps, setFps] = React.useState(15);
  const [hq, setHq] = React.useState(true);
  const [outName, setOutName] = React.useState("animation");

  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "processing">("idle");
  const [result, setResult] = React.useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function onFile(f: File) {
    setFile(f);
    setResult(null);
    setError(null);
    setOutName(sanitizeBaseName(f.name) || "animation");
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPhase(loaded ? "processing" : "loading");
      const ff = await ensure();
      setPhase("processing");

      const inName = safeName(file.name, file.name.split(".").pop() || "mp4");
      await ff.writeFile(inName, await fetchFileData(file));

      const dur = clamp(clipLen, 0.1, Math.max(0.1, duration - start || clipLen));
      const vf = `fps=${fps},scale=${width}:-2:flags=lanczos`;

      if (hq) {
        // Two-pass: palettegen → paletteuse for banding-free color.
        await ff.exec([
          "-ss", String(start), "-t", String(dur), "-i", inName,
          "-vf", `${vf},palettegen=stats_mode=diff`, "-y", "palette.png",
        ]);
        await ff.exec([
          "-ss", String(start), "-t", String(dur), "-i", inName, "-i", "palette.png",
          "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
          "-y", "out.gif",
        ]);
      } else {
        await ff.exec([
          "-ss", String(start), "-t", String(dur), "-i", inName, "-vf", vf, "-y", "out.gif",
        ]);
      }

      const data = await ff.readFile("out.gif");
      const blob = new Blob([data as BlobPart], { type: "image/gif" });
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Conversion failed. The file may use an unsupported codec."
      );
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  const progressValue = phase === "loading" ? loadRatio * 100 : jobRatio > 0 ? jobRatio * 100 : null;
  const progressStatus =
    phase === "loading"
      ? "Loading video engine (one-time, ~30 MB)…"
      : hq
      ? "Generating palette & encoding GIF…"
      : "Encoding GIF…";

  return (
    <ToolShell tool={tool}>
      {!file ? (
        <Dropzone
          accept="video/*,.mkv,.avi,.mov,.webm,.mp4"
          warnSizeMB={150}
          maxSizeMB={500}
          onFiles={(f) => onFile(f[0])}
          title="Drop a video to turn into a GIF"
          hint="MP4, MOV, WebM, MKV, AVI · trimming & palette optimization"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-xl border border-border bg-black"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  setDuration(d);
                  setClipLen(Math.min(3, d));
                }}
              />
            )}
            {result && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-sm font-medium">Result — {formatBytes(result.blob.size)}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.url} alt="GIF preview" className="mx-auto max-h-80 rounded-lg" />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Start (s)</Label>
                <Input
                  type="number"
                  min={0}
                  max={duration || undefined}
                  step={0.1}
                  value={start}
                  onChange={(e) => setStart(clamp(Number(e.target.value), 0, duration || 1e9))}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Duration (s)</Label>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={clipLen}
                  onChange={(e) => setClipLen(Math.max(0.1, Number(e.target.value)))}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Width (px)</Label>
                <Input
                  type="number"
                  min={16}
                  max={1280}
                  value={width}
                  onChange={(e) => setWidth(clamp(Number(e.target.value), 16, 1280))}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Frame rate</Label>
                <Select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {[8, 10, 12, 15, 20, 24, 30].map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <div>
                <Label htmlFor="hq" className="text-sm">
                  High-quality palette
                </Label>
                <p className="text-xs text-muted-foreground">Two-pass, avoids banding</p>
              </div>
              <Switch id="hq" checked={hq} onCheckedChange={setHq} />
            </div>

            {duration > 0 && (
              <p className="text-xs text-muted-foreground">
                Video is {duration.toFixed(1)}s. Aspect ratio is locked; height auto-scales.
              </p>
            )}

            <FilenameField value={outName} onChange={setOutName} extension="gif" />

            {busy && <ProgressBar value={progressValue} status={progressStatus} />}
            {error && <ErrorAlert message={error} />}

            <div className="flex flex-col gap-2">
              <Button onClick={run} disabled={busy}>
                <Film className="size-4" />
                Create GIF
              </Button>
              {result && (
                <Button
                  variant="secondary"
                  onClick={() => downloadBlob(result.blob, buildFilename(outName, "gif", "animation"))}
                >
                  <Download className="size-4" />
                  Download GIF ({formatBytes(result.blob.size)})
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  if (videoUrl) URL.revokeObjectURL(videoUrl);
                  setFile(null);
                  setVideoUrl(null);
                  setResult(null);
                }}
                disabled={busy}
              >
                <RefreshCw className="size-4" />
                Choose another video
              </Button>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
}
