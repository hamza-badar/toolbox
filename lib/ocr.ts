// Tesseract.js singleton worker. Worker script, wasm core and language
// traineddata are fetched by tesseract.js from its default CDN — recognition
// itself still runs locally in the browser (same trust model as ffmpeg.wasm).

import type { Worker as TesseractWorker } from "tesseract.js";

export const OCR_LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "spa", label: "Spanish" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "nld", label: "Dutch" },
  { code: "rus", label: "Russian" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
  { code: "chi_sim", label: "Chinese (Simplified)" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]["code"];

let workerInstance: TesseractWorker | null = null;
let workerLang: string | null = null;
let loadPromise: Promise<TesseractWorker> | null = null;

/** Load (once per language) and return the shared Tesseract worker. */
async function getWorker(lang: string, onLoadProgress?: (ratio: number) => void): Promise<TesseractWorker> {
  if (workerInstance && workerLang === lang) return workerInstance;
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    workerLang = null;
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(lang, undefined, {
      logger: (m) => {
        if (m.status === "recognizing text" || m.progress != null) {
          onLoadProgress?.(m.progress ?? 0);
        }
      },
    });
    workerInstance = worker;
    workerLang = lang;
    return worker;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null;
    workerInstance = null;
    workerLang = null;
    throw new Error(
      "Could not load the OCR engine. Check your connection and try again. " +
        (e instanceof Error ? e.message : "")
    );
  } finally {
    loadPromise = null;
  }
}

export interface OcrPageResult {
  text: string;
  confidence: number;
}

/**
 * Run OCR on a single image source (File, Blob, canvas or data URL).
 * `onProgress` receives 0–1 for the recognition step of this call.
 */
export async function recognizeText(
  image: File | Blob | HTMLCanvasElement | string,
  lang: OcrLanguage,
  onProgress?: (ratio: number) => void
): Promise<OcrPageResult> {
  const worker = await getWorker(lang, onProgress);
  const { data } = await worker.recognize(image);
  return { text: data.text, confidence: data.confidence };
}

export async function terminateOcrWorker() {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    workerLang = null;
  }
}
