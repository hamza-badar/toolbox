"use client";

import * as React from "react";
import { ImageDown, Download, RefreshCw } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useFFmpeg } from "@/components/shared/use-ffmpeg";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { fetchFileData, safeName } from "@/lib/ffmpeg";
import { zipBlobs } from "@/lib/zip";
import { FORMAT_MIME, LOSSY_FORMATS, type ImageFormat } from "@/lib/image";
import { downloadBlob, formatBytes, clamp } from "@/lib/utils";

/** Frames are held in memory before zipping — cap the job so tabs don't die. */
const FRAME_LIMIT_OPTIONS = [100, 300, 600, 1200, 3000];
const PREVIEW_COUNT = 12;

type ExtractFormat = Extract<ImageFormat, "png" | "jpeg" | "webp">;

/** ffmpeg writes frame_0001.png etc. — the muxer is picked by extension. */
const FRAME_EXT: Record<ExtractFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

export default function VideoToImagePage() {
  const tool = getTool("video-to-image")!;
  const { ensure, loaded, loadRatio, jobRatio } = useFFmpeg();

  const [file, setFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState(0);

  const [start, setStart] = React.useState(0);
  const [clipLen, setClipLen] = React.useState(0); // 0 = to the end
  const [everyFrame, setEveryFrame] = React.useState(true);
  const [fps, setFps] = React.useState(5);
  const [width, setWidth] = React.useState(0); // 0 = original size
  const [format, setFormat] = React.useState<ExtractFormat>("png");
  const [quality, setQuality] = React.useState(90);
  const [maxFrames, setMaxFrames] = React.useState(300);
  const [outName, setOutName] = React.useState("frames");

  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "processing" | "packing">("idle");
  const [result, setResult] = React.useState<
    { blob: Blob; count: number; previews: string[]; capped: boolean } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

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
  }

  function onFile(f: File) {
    releasePreviews();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(f);
    setResult(null);
    setError(null);
    setDuration(0);
    setStart(0);
    setClipLen(0);
    setOutName(sanitizeBaseName(f.name) || "frames");
    setVideoUrl(URL.createObjectURL(f));
  }

  const effLen = clipLen > 0 ? clipLen : Math.max(0, duration - start);
  /** Rough count so users can see a runaway job before starting it. The
   *  browser exposes no frame rate, so "every frame" assumes ~30 fps. */
  const estimated = effLen > 0 ? Math.round(effLen * (everyFrame ? 30 : fps)) : null;

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    releasePreviews();
    setResult(null);
    try {
      setPhase(loaded ? "processing" : "loading");
      const ff = await ensure();
      setPhase("processing");

      const ext = file.name.split(".").pop() || "mp4";
      const inName = safeName(file.name, ext);
      await ff.writeFile(inName, await fetchFileData(file));

      const frameExt = FRAME_EXT[format];
      const pattern = `frame_%05d.${frameExt}`;

      const filters: string[] = [];
      if (!everyFrame) filters.push(`fps=${fps}`);
      if (width > 0) filters.push(`scale=${width}:-2:flags=lanczos`);

      const args: string[] = [];
      if (start > 0) args.push("-ss", String(start));
      if (clipLen > 0) args.push("-t", String(clipLen));
      args.push("-i", inName);
      if (filters.length) args.push("-vf", filters.join(","));
      // Every input frame, not just keyframes; -vsync 0 keeps timing from
      // duplicating or dropping frames when the source is variable-rate.
      args.push("-vsync", "0");
      if (format === "jpeg") {
        // -q:v runs 2 (best) → 31 (worst).
        args.push("-q:v", String(clamp(Math.round(31 - (quality / 100) * 29), 2, 31)));
      } else if (format === "webp") {
        args.push("-quality", String(quality));
      }
      args.push("-frames:v", String(maxFrames), "-y", pattern);

      await ff.exec(args);

      setPhase("packing");
      const dir = await ff.listDir("/");
      const names = dir
        .filter((e) => !e.isDir && /^frame_\d+\./.test(e.name))
        .map((e) => e.name)
        .sort();

      if (!names.length) {
        throw new Error("No frames were produced. The video codec may be unsupported.");
      }

      const mime = FORMAT_MIME[format];
      const base = sanitizeBaseName(outName) || "frames";
      const entries: { name: string; blob: Blob }[] = [];
      const previews: string[] = [];

      for (let i = 0; i < names.length; i++) {
        const data = await ff.readFile(names[i]);
        const blob = new Blob([data as BlobPart], { type: mime });
        entries.push({ name: `${base}_${String(i + 1).padStart(5, "0")}.${frameExt}`, blob });
        if (previews.length < PREVIEW_COUNT) previews.push(URL.createObjectURL(blob));
        await ff.deleteFile(names[i]);
      }
      await ff.deleteFile(inName);

      previewsRef.current = previews;
      const zip = await zipBlobs(entries);
      setResult({ blob: zip, count: entries.length, previews, capped: entries.length >= maxFrames });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Extraction failed. The file may use an unsupported codec."
      );
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  const progressValue =
    phase === "loading" ? loadRatio * 100 : phase === "packing" ? null : jobRatio > 0 ? jobRatio * 100 : null;
  const progressStatus =
    phase === "loading"
      ? "Loading video engine (one-time, ~30 MB)…"
      : phase === "packing"
      ? "Building ZIP archive…"
      : "Extracting frames…";

  return (
    <ToolShell tool={tool}>
      {!file ? (
        <Dropzone
          accept="video/*,.mkv,.avi,.mov,.webm,.mp4"
          warnSizeMB={150}
          maxSizeMB={500}
          onFiles={(f) => onFile(f[0])}
          title="Drop a video to split into images"
          hint="MP4, MOV, WebM, MKV, AVI · every frame as PNG, JPEG or WebP in a ZIP"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-xl border border-border bg-black"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              />
            )}
            {result && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 text-sm font-medium">
                  {result.count} frames · {formatBytes(result.blob.size)} ZIP
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {result.previews.map((src, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={src}
                      src={src}
                      alt={`Frame ${i + 1}`}
                      className="aspect-square w-full rounded-lg bg-muted object-contain"
                    />
                  ))}
                </div>
                {result.count > result.previews.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the first {result.previews.length} frames — all {result.count} are in the ZIP.
                  </p>
                )}
                {result.capped && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Stopped at the {maxFrames}-frame limit. Raise it or trim the clip for more.
                  </p>
                )}
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
                  min={0}
                  step={0.1}
                  value={clipLen}
                  onChange={(e) => setClipLen(Math.max(0, Number(e.target.value)))}
                  placeholder="0 = to end"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Frames</Label>
                <Select
                  value={everyFrame ? "all" : "fps"}
                  onChange={(e) => setEveryFrame(e.target.value === "all")}
                >
                  <option value="all">Every frame</option>
                  <option value="fps">Every Nth (fps)</option>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Rate</Label>
                <Select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  disabled={everyFrame}
                >
                  {[1, 2, 3, 5, 10, 15, 24, 30].map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Width (px)</Label>
                <Input
                  type="number"
                  min={0}
                  max={3840}
                  value={width}
                  onChange={(e) => setWidth(clamp(Number(e.target.value), 0, 3840))}
                  placeholder="0 = original"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Format</Label>
                <Select value={format} onChange={(e) => setFormat(e.target.value as ExtractFormat)}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </Select>
              </div>
            </div>

            {LOSSY_FORMATS.includes(format) && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Quality</Label>
                  <span className="font-mono text-xs tabular-nums">{quality}</span>
                </div>
                <Slider value={quality} min={40} max={100} onChange={setQuality} />
              </div>
            )}

            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Max frames</Label>
              <Select value={maxFrames} onChange={(e) => setMaxFrames(Number(e.target.value))}>
                {FRAME_LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} frames
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {estimated != null
                  ? `${everyFrame ? "≈" : ""} ${estimated} frames from ${effLen.toFixed(1)}s${
                      estimated > maxFrames ? ` — capped at ${maxFrames}` : ""
                    }`
                  : "Everything runs in this tab, so very long clips can be slow."}
              </p>
            </div>

            <FilenameField value={outName} onChange={setOutName} extension="zip" />

            {busy && <ProgressBar value={progressValue} status={progressStatus} />}
            {error && <ErrorAlert message={error} />}

            <div className="flex flex-col gap-2">
              <Button onClick={run} disabled={busy}>
                <ImageDown className="size-4" />
                Extract frames
              </Button>
              {result && (
                <Button
                  variant="secondary"
                  onClick={() => downloadBlob(result.blob, buildFilename(outName, "zip", "video-frames"))}
                >
                  <Download className="size-4" />
                  Download ZIP ({formatBytes(result.blob.size)})
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  if (videoUrl) URL.revokeObjectURL(videoUrl);
                  releasePreviews();
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
