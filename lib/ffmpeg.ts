// Single-threaded ffmpeg.wasm singleton. The core is fetched from a CDN and
// turned into blob URLs (via @ffmpeg/util) so no special COOP/COEP headers are
// needed. Everything runs in the browser — files never touch a server.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

// Core matched to @ffmpeg/ffmpeg 0.12.x. Single-thread UMD build.
const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export interface FfmpegProgress {
  /** 0–1 while ffmpeg processes the current job. */
  ratio: number;
}

let progressListener: ((p: FfmpegProgress) => void) | null = null;

/** Subscribe to per-job progress (0–1). Returns an unsubscribe fn. */
export function onFfmpegProgress(cb: (p: FfmpegProgress) => void) {
  progressListener = cb;
  return () => {
    if (progressListener === cb) progressListener = null;
  };
}

/**
 * Load (once) and return the shared FFmpeg instance.
 * `onLoadProgress` reports 0–1 while the ~30 MB core downloads.
 */
export async function getFFmpeg(onLoadProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");

    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      if (progressListener) progressListener({ ratio: Math.max(0, Math.min(1, progress)) });
    });

    // toBlobURL streams progress; approximate a 0–1 download bar.
    onLoadProgress?.(0.05);
    const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
    onLoadProgress?.(0.35);
    const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
    onLoadProgress?.(0.85);

    await ffmpeg.load({ coreURL, wasmURL });
    onLoadProgress?.(1);

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null; // allow retry
    throw new Error(
      "Could not load the video engine. Check your connection and try again. " +
        (e instanceof Error ? e.message : "")
    );
  }
}

export function isFFmpegLoaded() {
  return ffmpegInstance !== null;
}

/** Read a File into ffmpeg's virtual FS-friendly Uint8Array. */
export async function fetchFileData(file: File): Promise<Uint8Array> {
  const { fetchFile } = await import("@ffmpeg/util");
  return fetchFile(file);
}

/** Sanitize a user filename into something safe for ffmpeg's virtual FS. */
export function safeName(name: string, fallbackExt: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "");
  return `${base || "input"}.${fallbackExt}`;
}
