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
