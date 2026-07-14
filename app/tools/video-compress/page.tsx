"use client";

import * as React from "react";
import { Clapperboard, Download, RefreshCw } from "lucide-react";
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
import { TargetSizeField } from "@/components/shared/target-size-field";
import { AlertDialog } from "@/components/shared/alert-dialog";
import { fetchFileData, safeName } from "@/lib/ffmpeg";
import { downloadBlob, formatBytes, clamp } from "@/lib/utils";

export default function VideoCompressPage() {
  const tool = getTool("video-compress")!;
  const { ensure, loaded, loadRatio, jobRatio } = useFFmpeg();

  const [file, setFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState(0);

  const [mode, setMode] = React.useState<"crf" | "size">("crf");
  const [crf, setCrf] = React.useState(28);
  const [targetMB, setTargetMB] = React.useState<number | null>(10);
  const [scale, setScale] = React.useState("keep");
  const [start, setStart] = React.useState(0);
  const [clipLen, setClipLen] = React.useState(0); // 0 = whole (from start)
  const [outName, setOutName] = React.useState("compressed");

  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "loading" | "processing">("idle");
  const [result, setResult] = React.useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [invalidAlert, setInvalidAlert] = React.useState(false);

  const invalidTarget = mode === "size" && (targetMB === null || targetMB < 0.5);

  const scaleFilter =
    scale === "keep"
      ? "scale=trunc(iw/2)*2:trunc(ih/2)*2"
      : `scale=-2:${scale}`;

  async function run() {
    if (!file) return;
    if (invalidTarget) {
      setInvalidAlert(true);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPhase(loaded ? "processing" : "loading");
      const ff = await ensure();
      setPhase("processing");

      const ext = file.name.split(".").pop() || "mp4";
      const inName = safeName(file.name, ext);
      await ff.writeFile(inName, await fetchFileData(file));

      const trim: string[] = [];
      if (start > 0) trim.push("-ss", String(start));
      const effLen = clipLen > 0 ? clipLen : Math.max(0.1, duration - start);
      if (clipLen > 0) trim.push("-t", String(clipLen));

      let args: string[];
      if (mode === "size") {
        // Compute a total bitrate to land near the target size.
        const audioKbps = 128;
        const totalKbps = ((targetMB as number) * 8 * 1024) / effLen;
        const videoKbps = Math.max(80, Math.round(totalKbps - audioKbps));
        args = [
          ...trim, "-i", inName,
          "-c:v", "libx264", "-b:v", `${videoKbps}k`,
          "-maxrate", `${Math.round(videoKbps * 1.45)}k`, "-bufsize", `${videoKbps * 2}k`,
          "-preset", "veryfast", "-pix_fmt", "yuv420p", "-vf", scaleFilter,
          "-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart", "-y", "out.mp4",
        ];
      } else {
        args = [
          ...trim, "-i", inName,
          "-c:v", "libx264", "-crf", String(crf), "-preset", "veryfast",
          "-pix_fmt", "yuv420p", "-vf", scaleFilter,
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", "out.mp4",
        ];
      }

      await ff.exec(args);
      const data = await ff.readFile("out.mp4");
      const blob = new Blob([data as BlobPart], { type: "video/mp4" });
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compression failed. The codec may be unsupported.");
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
          accept="video/*,.mkv,.avi,.mov,.webm,.mp4"
          warnSizeMB={150}
          maxSizeMB={500}
          onFiles={(f) => {
            setFile(f[0]);
            setResult(null);
            setError(null);
            setVideoUrl(URL.createObjectURL(f[0]));
            setOutName(`${sanitizeBaseName(f[0].name)}-compressed`);
          }}
          title="Drop a video to compress"
          hint="Trim & re-encode (H.264 MP4) by quality or target size"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {videoUrl && (
              <video
                src={result ? result.url : videoUrl}
                controls
                className="w-full rounded-xl border border-border bg-black"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              />
            )}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>Original: {formatBytes(file.size)}</span>
              {result && (
                <span className="text-success">
                  Compressed: {formatBytes(result.blob.size)} (
                  {Math.round((1 - result.blob.size / file.size) * 100)}% smaller)
                </span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Compression mode</Label>
              <Select value={mode} onChange={(e) => setMode(e.target.value as "crf" | "size")}>
                <option value="crf">Quality (CRF)</option>
                <option value="size">Target size (MB)</option>
              </Select>
            </div>

            {mode === "crf" ? (
              <div>
                <Label className="mb-1.5 block">
                  Quality — CRF {crf} {crf <= 23 ? "(high)" : crf >= 30 ? "(small file)" : "(balanced)"}
                </Label>
                <Slider value={crf} min={18} max={36} onChange={setCrf} />
                <p className="mt-1 text-xs text-muted-foreground">Lower = better quality, larger file.</p>
              </div>
            ) : (
              <TargetSizeField
                label="Target size (MB)"
                value={targetMB ?? 10}
                onChange={setTargetMB}
                min={0.5}
                step={0.5}
                unit="MB"
                resetKey={file?.name}
              />
            )}

            <div>
              <Label className="mb-1.5 block">Resolution</Label>
              <Select value={scale} onChange={(e) => setScale(e.target.value)}>
                <option value="keep">Keep original</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Trim start (s)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={start}
                  onChange={(e) => setStart(clamp(Number(e.target.value), 0, duration || 1e9))}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Length (s, 0=all)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clipLen}
                  onChange={(e) => setClipLen(Math.max(0, Number(e.target.value)))}
                />
              </div>
            </div>

            {busy && (
              <ProgressBar
                value={progressValue}
                status={phase === "loading" ? "Loading video engine (one-time)…" : "Re-encoding video…"}
              />
            )}
            {error && <ErrorAlert message={error} />}

            <FilenameField value={outName} onChange={setOutName} extension="mp4" />

            <div className="flex flex-col gap-2">
              <Button onClick={run} disabled={busy}>
                <Clapperboard className="size-4" />
                Compress video
              </Button>
              {result && (
                <Button
                  variant="secondary"
                  onClick={() => downloadBlob(result.blob, buildFilename(outName, "mp4", "compressed"))}
                >
                  <Download className="size-4" />
                  Download ({formatBytes(result.blob.size)})
                </Button>
              )}
              <Button variant="ghost" onClick={() => { setFile(null); setResult(null); }} disabled={busy}>
                <RefreshCw className="size-4" />
                Choose another video
              </Button>
            </div>
          </div>
        </div>
      )}
      {invalidAlert && (
        <AlertDialog
          title="Fix the target size first"
          message="Enter a target size of at least 0.5 MB before compressing."
          onClose={() => setInvalidAlert(false)}
        />
      )}
    </ToolShell>
  );
}
