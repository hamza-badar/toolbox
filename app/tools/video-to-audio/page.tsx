"use client";

import * as React from "react";
import { AudioLines, Download, RefreshCw } from "lucide-react";
import { getTool } from "@/lib/tools";
import { ToolShell } from "@/components/shared/tool-shell";
import { Dropzone } from "@/components/shared/dropzone";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ErrorAlert } from "@/components/shared/error-alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useFFmpeg } from "@/components/shared/use-ffmpeg";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { fetchFileData, safeName } from "@/lib/ffmpeg";
import { downloadBlob, formatBytes } from "@/lib/utils";

type AudioFormat = "mp3" | "wav" | "m4a";

const FORMATS: Record<AudioFormat, { ext: string; mime: string; args: string[]; label: string }> = {
  mp3: { ext: "mp3", mime: "audio/mpeg", args: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"], label: "MP3" },
  wav: { ext: "wav", mime: "audio/wav", args: ["-vn", "-c:a", "pcm_s16le"], label: "WAV (lossless)" },
  m4a: { ext: "m4a", mime: "audio/mp4", args: ["-vn", "-c:a", "aac", "-b:a", "192k"], label: "AAC / M4A" },
};

export default function VideoToAudioPage() {
  const tool = getTool("video-to-audio")!;
  const { ensure, loaded, loadRatio, jobRatio } = useFFmpeg();

  const [file, setFile] = React.useState<File | null>(null);
  const [format, setFormat] = React.useState<AudioFormat>("mp3");
  const [outName, setOutName] = React.useState("audio");
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

      const inName = safeName(file.name, file.name.split(".").pop() || "mp4");
      await ff.writeFile(inName, await fetchFileData(file));

      const conf = FORMATS[format];
      const outName = `out.${conf.ext}`;
      await ff.exec(["-i", inName, ...conf.args, "-y", outName]);
      const data = await ff.readFile(outName);
      const blob = new Blob([data as BlobPart], { type: conf.mime });
      if (blob.size === 0) throw new Error("No audio track was found in this video.");
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
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
            setOutName(sanitizeBaseName(f[0].name) || "audio");
          }}
          title="Drop a video to extract its audio"
          hint="Export as MP3, WAV or AAC/M4A"
        />
      ) : (
        <div className="mx-auto max-w-xl space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground">{formatBytes(file.size)}</p>
          </div>

          <div>
            <Label className="mb-1.5 block">Audio format</Label>
            <Select value={format} onChange={(e) => setFormat(e.target.value as AudioFormat)}>
              {Object.entries(FORMATS).map(([key, v]) => (
                <option key={key} value={key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <FilenameField value={outName} onChange={setOutName} extension={FORMATS[format].ext} />

          {busy && (
            <ProgressBar
              value={progressValue}
              status={phase === "loading" ? "Loading audio engine (one-time)…" : "Extracting audio…"}
            />
          )}
          {error && <ErrorAlert message={error} />}

          {result && (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-2 text-sm font-medium">
                Extracted audio — {formatBytes(result.blob.size)}
              </p>
              <audio src={result.url} controls className="w-full" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={run} disabled={busy}>
              <AudioLines className="size-4" />
              Extract audio
            </Button>
            {result && (
              <Button
                variant="secondary"
                onClick={() => downloadBlob(result.blob, buildFilename(outName, FORMATS[format].ext, "audio"))}
              >
                <Download className="size-4" />
                Download {FORMATS[format].label}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setFile(null); setResult(null); }} disabled={busy}>
              <RefreshCw className="size-4" />
              Choose another video
            </Button>
          </div>
        </div>
      )}
    </ToolShell>
  );
}
