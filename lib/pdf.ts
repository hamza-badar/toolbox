// Client-side PDF helpers. pdfjs renders pages to canvas; pdf-lib builds/edits.
// Heavy libs are dynamically imported so they only load on PDF tool pages.

import type { PDFDocumentProxy } from "pdfjs-dist";

// The legacy build is bundler-friendly — the modern `pdfjs-dist/build/pdf.mjs`
// trips Next.js's webpack ESM interop ("Object.defineProperty called on
// non-object"). The legacy build renders identically.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      // Worker is served from /public (copied from pdfjs-dist at build time).
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  // Clone into a fresh Uint8Array — pdfjs transfers/detaches the buffer.
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
}

/** Render one page into a fresh canvas at the given scale. */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

/** Render a small thumbnail data URL for a page (used by the organizer). */
export async function renderThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 160
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = maxWidth / base.width;
  const canvas = await renderPageToCanvas(doc, pageNumber, scale);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export type PdfMode = "scanned" | "text";

export interface CompressResult {
  blob: Blob;
  achievedBytes: number;
  scale: number;
  quality: number;
  pages: number;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode page image."))),
      "image/jpeg",
      quality
    )
  );
}

/**
 * Rasterize every page to JPEG and rebuild the PDF, binary-searching on JPEG
 * quality (and downscaling render resolution if needed) to hit a target size.
 *
 * NOTE: rasterizing removes selectable/searchable text — surfaced in the UI.
 */
export async function compressPdfToTarget(
  file: File,
  targetBytes: number,
  opts: { mode: PdfMode; onProgress?: (value: number, status: string) => void }
): Promise<CompressResult> {
  const { PDFDocument } = await import("pdf-lib");
  const buffer = await file.arrayBuffer();
  const doc = await loadPdfDocument(buffer);
  const numPages = doc.numPages;

  // Text documents need a higher resolution floor to stay legible; scanned/image
  // PDFs can be pushed harder.
  let scale = opts.mode === "text" ? 2.0 : 1.6;
  const minScale = opts.mode === "text" ? 1.2 : 0.7;

  let bestResult: CompressResult | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    opts.onProgress?.(5 + attempt * 5, `Rendering ${numPages} page(s) at ${Math.round(scale * 100)}%…`);

    // Render every page once at this scale.
    const canvases: HTMLCanvasElement[] = [];
    for (let p = 1; p <= numPages; p++) {
      canvases.push(await renderPageToCanvas(doc, p, scale));
      opts.onProgress?.(
        10 + (p / numPages) * 30,
        `Rendering page ${p} of ${numPages}…`
      );
    }

    // Binary-search a single JPEG quality applied to all pages, using summed
    // JPEG bytes (plus small overhead) as a fast proxy for final PDF size.
    const overhead = 1024 + numPages * 256;
    let lo = 0.2;
    let hi = 0.92;
    let chosenQ = lo;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      let total = overhead;
      for (const c of canvases) {
        const blob = await canvasToJpegBlob(c, q);
        total += blob.size;
      }
      opts.onProgress?.(45 + i * 4, `Testing quality ${Math.round(q * 100)}%…`);
      if (total <= targetBytes) {
        chosenQ = q;
        lo = q;
      } else {
        hi = q;
      }
    }

    // Build the actual PDF at the chosen quality.
    opts.onProgress?.(80, "Rebuilding PDF…");
    const outDoc = await PDFDocument.create();
    for (const c of canvases) {
      const blob = await canvasToJpegBlob(c, chosenQ);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const jpg = await outDoc.embedJpg(bytes);
      const page = outDoc.addPage([c.width, c.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: c.width, height: c.height });
    }
    const outBytes = await outDoc.save();
    const blob = new Blob([outBytes as BlobPart], { type: "application/pdf" });
    const result: CompressResult = {
      blob,
      achievedBytes: blob.size,
      scale,
      quality: chosenQ,
      pages: numPages,
    };

    if (!bestResult || result.achievedBytes < bestResult.achievedBytes) bestResult = result;
    if (blob.size <= targetBytes) return result;

    // Overshot even at this scale — drop resolution and retry.
    const next = scale * 0.8;
    if (next < minScale) break;
    scale = next;
  }

  return bestResult!;
}

/**
 * Parse a page selection like "1-3, 5, 6" into 1-based page numbers.
 * Empty input means every page. Ranges may be written either way (3-1).
 * Invalid tokens are skipped; duplicates keep first-seen order.
 */
export function parsePageSelection(input: string, pageCount: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const seen = new Set<number>();
  const out: number[] = [];

  for (const raw of trimmed.split(",")) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = parseInt(range[1], 10);
      let b = parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a];
      a = Math.max(1, a);
      b = Math.min(pageCount, b);
      for (let i = a; i <= b; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          out.push(i);
        }
      }
      continue;
    }

    const n = parseInt(chunk, 10);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }

  return out;
}

/** Safe canvas edge length across Chromium / Safari / Firefox. */
export const MAX_CANVAS_EDGE = 16384;

/**
 * Stack page canvases top-to-bottom into one image, scaling each to a shared
 * width. Shrinks the whole strip if it would exceed the browser canvas cap.
 */
export function stitchCanvasesVertically(
  canvases: HTMLCanvasElement[],
  maxEdge = MAX_CANVAS_EDGE
): HTMLCanvasElement {
  if (!canvases.length) throw new Error("No pages to stitch.");
  if (canvases.length === 1) return canvases[0];

  const maxW = Math.max(...canvases.map((c) => c.width), 1);
  const scaledHeights = canvases.map((c) =>
    c.width === 0 ? 0 : (c.height * maxW) / c.width
  );
  const totalH = scaledHeights.reduce((a, b) => a + b, 0) || 1;

  const fit = Math.min(1, maxEdge / maxW, maxEdge / totalH);
  const outW = Math.max(1, Math.round(maxW * fit));
  const outH = Math.max(1, Math.round(totalH * fit));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = "high";

  let y = 0;
  for (let i = 0; i < canvases.length; i++) {
    const dh = Math.max(1, Math.round(scaledHeights[i] * fit));
    ctx.drawImage(canvases[i], 0, y, outW, dh);
    y += dh;
  }
  return out;
}
