// Client-side image helpers built on the Canvas API. No network, no workers.

export type ImageFormat = "png" | "jpeg" | "webp" | "avif";

export const FORMAT_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export const LOSSY_FORMATS: ImageFormat[] = ["jpeg", "webp", "avif"];

export interface DimensionPreset {
  group: string;
  label: string;
  /** Target pixel dimensions. */
  width: number;
  height: number;
  /** Suggested background when padding (hex). */
  background?: string;
  note?: string;
}

/**
 * Photo/social presets. ID-photo specs change over time — these reflect the
 * spec current as of this build (mid-2025). The editor also exposes a custom
 * mm/px option so users are never locked to a possibly-stale preset.
 */
export const DIMENSION_PRESETS: DimensionPreset[] = [
  // --- ID / passport photos ---
  {
    group: "ID Photos",
    label: "India Passport (630×810, post-Sept 2025)",
    width: 630,
    height: 810,
    background: "#ffffff",
    note: "35×45 mm digital upload, white background (ICAO update).",
  },
  {
    group: "ID Photos",
    label: "India OCI / e-Visa (900×900)",
    width: 900,
    height: 900,
    background: "#ffffff",
    note: "51×51 mm (2×2 in) square, light background.",
  },
  {
    group: "ID Photos",
    label: "US Passport/Visa (600×600)",
    width: 600,
    height: 600,
    background: "#ffffff",
    note: "2×2 in (51×51 mm), white background.",
  },
  {
    group: "ID Photos",
    label: "UK / Schengen / EU (35×45 mm → 413×531)",
    width: 413,
    height: 531,
    background: "#ffffff",
    note: "35×45 mm at 300 DPI.",
  },
  // --- Social ---
  { group: "Social", label: "Instagram Post (1080×1080)", width: 1080, height: 1080 },
  { group: "Social", label: "Instagram Story (1080×1920)", width: 1080, height: 1920 },
  { group: "Social", label: "YouTube Thumbnail (1280×720)", width: 1280, height: 720 },
  { group: "Social", label: "LinkedIn Profile (400×400)", width: 400, height: 400 },
  { group: "Social", label: "Facebook Cover (820×312)", width: 820, height: 312 },
  { group: "Social", label: "Twitter/X Image (1600×900)", width: 1600, height: 900 },
];

/** Convert millimetres to pixels at a given DPI. */
export function mmToPx(mm: number, dpi = 300): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Load a File/Blob into an HTMLImageElement (via object URL). */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode this image. It may be corrupt or an unsupported format."));
    };
    img.src = url;
  });
}

/** Canvas.toBlob wrapped in a promise. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Your browser could not export to ${format.toUpperCase()}.`));
      },
      FORMAT_MIME[format],
      quality
    );
  });
}

/** Detect whether the browser can actually encode a given format (AVIF/WebP vary). */
export async function canEncode(format: ImageFormat): Promise<boolean> {
  try {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 2;
    const blob = await canvasToBlob(c, format, 0.8);
    // Some browsers silently fall back to PNG — check the returned type.
    return blob.type === FORMAT_MIME[format];
  } catch {
    return false;
  }
}

export interface Adjustments {
  brightness: number; // 0–200, 100 = neutral
  contrast: number; // 0–200
  saturation: number; // 0–200
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

export function adjustmentsToFilter(a: Adjustments): string {
  return `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturation}%)`;
}

export type ColorMode = "original" | "grayscale" | "bw";

/**
 * Build a CSS/canvas filter string for a color mode plus adjustments. The same
 * string works for both live CSS preview and canvas export, so they always match.
 */
export function buildColorFilter(mode: ColorMode, a: Adjustments): string {
  const base = adjustmentsToFilter(a);
  if (mode === "grayscale") return `grayscale(1) ${base}`;
  if (mode === "bw") return `grayscale(1) contrast(320%) ${base}`;
  return base;
}

export interface RenderOptions {
  /** Output pixel size. If omitted, uses the source crop size. */
  targetWidth?: number;
  targetHeight?: number;
  /** How to fit source into target: "cover" crops, "contain" pads with background. */
  fit?: "cover" | "contain" | "stretch";
  background?: string;
  rotate?: number; // degrees
  flipH?: boolean;
  flipV?: boolean;
  adjustments?: Adjustments;
  /** Crop rectangle in source pixels applied before everything else. */
  crop?: { x: number; y: number; width: number; height: number };
}

/**
 * Render an image through a full transform pipeline into a fresh canvas.
 * Order: crop → rotate/flip → scale-to-fit into target with background.
 */
export function renderToCanvas(img: HTMLImageElement, opts: RenderOptions = {}): HTMLCanvasElement {
  const crop = opts.crop ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };

  // Stage 1: crop + rotate/flip into an intermediate canvas.
  const rot = ((opts.rotate ?? 0) % 360) * (Math.PI / 180);
  const swap = Math.abs(Math.round((opts.rotate ?? 0) / 90)) % 2 === 1;
  const stageW = swap ? crop.height : crop.width;
  const stageH = swap ? crop.width : crop.height;

  const stage = document.createElement("canvas");
  stage.width = Math.max(1, Math.round(stageW));
  stage.height = Math.max(1, Math.round(stageH));
  const sctx = stage.getContext("2d")!;
  sctx.save();
  sctx.translate(stage.width / 2, stage.height / 2);
  sctx.rotate(rot);
  sctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
  if (opts.adjustments) sctx.filter = adjustmentsToFilter(opts.adjustments);
  sctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -crop.width / 2,
    -crop.height / 2,
    crop.width,
    crop.height
  );
  sctx.restore();

  const targetW = Math.max(1, Math.round(opts.targetWidth ?? stage.width));
  const targetH = Math.max(1, Math.round(opts.targetHeight ?? stage.height));
  const fit = opts.fit ?? "cover";

  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";

  if (opts.background) {
    octx.fillStyle = opts.background;
    octx.fillRect(0, 0, targetW, targetH);
  }

  if (fit === "stretch") {
    octx.drawImage(stage, 0, 0, targetW, targetH);
  } else {
    const scale =
      fit === "cover"
        ? Math.max(targetW / stage.width, targetH / stage.height)
        : Math.min(targetW / stage.width, targetH / stage.height);
    const dw = stage.width * scale;
    const dh = stage.height * scale;
    octx.drawImage(stage, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
  }

  return out;
}

/**
 * Crop a (possibly rotated) image the way react-easy-crop reports it: the crop
 * area is expressed in the coordinate space of the image's rotation bounding
 * box. We rotate the whole image into that box, apply adjustments, then extract
 * the crop rectangle. Flip must already be baked into `image`.
 */
export function getCroppedCanvas(
  image: HTMLImageElement,
  area: { x: number; y: number; width: number; height: number },
  rotationDeg = 0,
  filter?: string
): HTMLCanvasElement {
  const rot = (rotationDeg * Math.PI) / 180;
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const bboxW = Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * h;
  const bboxH = Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * h;

  const full = document.createElement("canvas");
  full.width = Math.round(bboxW);
  full.height = Math.round(bboxH);
  const fctx = full.getContext("2d")!;
  fctx.imageSmoothingQuality = "high";
  if (filter && filter !== "none") fctx.filter = filter;
  fctx.translate(bboxW / 2, bboxH / 2);
  fctx.rotate(rot);
  fctx.drawImage(image, -w / 2, -h / 2);

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(area.width));
  out.height = Math.max(1, Math.round(area.height));
  out
    .getContext("2d")!
    .drawImage(full, area.x, area.y, area.width, area.height, 0, 0, out.width, out.height);
  return out;
}

/** Scale a source canvas into a target size with cover/contain/stretch fit. */
export function fitCanvasToTarget(
  src: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  fit: "cover" | "contain" | "stretch",
  background?: string
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(targetWidth));
  out.height = Math.max(1, Math.round(targetHeight));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  if (fit === "stretch") {
    ctx.drawImage(src, 0, 0, out.width, out.height);
  } else {
    const scale =
      fit === "cover"
        ? Math.max(out.width / src.width, out.height / src.height)
        : Math.min(out.width / src.width, out.height / src.height);
    const dw = src.width * scale;
    const dh = src.height * scale;
    ctx.drawImage(src, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
  }
  return out;
}

export type Point = [number, number];

/** Solve the 3x3 homography H (h33=1) mapping the 4 `from` points to `to`. */
function solveHomography(from: Point[], to: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [X, Y] = to[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  // Gaussian elimination with partial pivoting on the 8x8 system.
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const d = A[col][col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = b.map((val, i) => val / (A[i][i] || 1e-9));
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * De-skew a quadrilateral region of an image into a straight rectangle — the
 * "document scanner" crop. `corners` are 4 points in normalized [0,1] image
 * coordinates, ordered top-left, top-right, bottom-right, bottom-left.
 */
export function perspectiveCrop(
  image: HTMLImageElement,
  corners: Point[],
  filter?: string
): HTMLCanvasElement {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const src: Point[] = corners.map(([nx, ny]) => [nx * iw, ny * ih]);
  const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  let W = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])));
  let H = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])));
  const cap = 2200;
  const scale = Math.min(1, cap / Math.max(W, H, 1));
  W = Math.max(1, Math.round(W * scale));
  H = Math.max(1, Math.round(H * scale));

  const dst: Point[] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  const m = solveHomography(dst, src); // maps output pixel -> source pixel

  const sc = document.createElement("canvas");
  sc.width = iw;
  sc.height = ih;
  sc.getContext("2d")!.drawImage(image, 0, 0);
  const sdata = sc.getContext("2d")!.getImageData(0, 0, iw, ih).data;

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  const odata = octx.createImageData(W, H);
  const od = odata.data;

  const sample = (sx: number, sy: number, o: number) => {
    const x = Math.max(0, Math.min(iw - 1, sx));
    const y = Math.max(0, Math.min(ih - 1, sy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(iw - 1, x0 + 1);
    const y1 = Math.min(ih - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    for (let ch = 0; ch < 4; ch++) {
      const i00 = (y0 * iw + x0) * 4 + ch;
      const i10 = (y0 * iw + x1) * 4 + ch;
      const i01 = (y1 * iw + x0) * 4 + ch;
      const i11 = (y1 * iw + x1) * 4 + ch;
      const top = sdata[i00] * (1 - fx) + sdata[i10] * fx;
      const bot = sdata[i01] * (1 - fx) + sdata[i11] * fx;
      od[o + ch] = top * (1 - fy) + bot * fy;
    }
  };

  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const dw = m[6] * u + m[7] * v + m[8];
      const sx = (m[0] * u + m[1] * v + m[2]) / dw;
      const sy = (m[3] * u + m[4] * v + m[5]) / dw;
      sample(sx, sy, (v * W + u) * 4);
    }
  }
  octx.putImageData(odata, 0, 0);

  if (filter && filter !== "none") {
    const f = document.createElement("canvas");
    f.width = W;
    f.height = H;
    const fctx = f.getContext("2d")!;
    fctx.filter = filter;
    fctx.drawImage(out, 0, 0);
    return f;
  }
  return out;
}

/**
 * Bake a 90°-step rotation plus optional flips into a fresh canvas. Keeps the
 * result rectangular (no transparent corners), so a handle-based cropper can
 * work in the baked image's own pixel space.
 */
export function bakeOrientation(
  image: HTMLImageElement,
  rotateDeg: number,
  flipH: boolean,
  flipV: boolean
): HTMLCanvasElement {
  const steps = ((Math.round(rotateDeg / 90) % 4) + 4) % 4;
  const swap = steps % 2 === 1;
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((steps * Math.PI) / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(image, -w / 2, -h / 2);
  return canvas;
}

/** Produce a horizontally/vertically flipped copy of an image as a canvas. */
export function flipImageToCanvas(
  image: HTMLImageElement,
  flipH: boolean,
  flipV: boolean
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/**
 * Compress an image toward a target byte size via binary search on JPEG/WebP
 * quality, then downscaling if the quality floor still overshoots.
 */
export async function compressToTargetBytes(
  img: HTMLImageElement,
  targetBytes: number,
  format: Extract<ImageFormat, "jpeg" | "webp">,
  opts: { minQuality?: number; onProgress?: (info: string) => void } = {}
): Promise<{ blob: Blob; quality: number; scale: number }> {
  const minQuality = opts.minQuality ?? 0.3;
  let scale = 1;

  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(16, Math.round(img.naturalWidth * scale));
    const h = Math.max(16, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    // Binary search quality at this resolution.
    let lo = 0.05;
    let hi = 0.98;
    let best: Blob | null = null;
    let bestQ = lo;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      opts.onProgress?.(`Scale ${(scale * 100) | 0}% · quality ${(q * 100) | 0}%`);
      const blob = await canvasToBlob(canvas, format, q);
      if (blob.size <= targetBytes) {
        best = blob;
        bestQ = q;
        lo = q; // try higher quality
      } else {
        hi = q;
      }
    }

    if (best) return { blob: best, quality: bestQ, scale };

    // Even lowest quality overshot — check the floor blob; if still too big, downscale.
    const floor = await canvasToBlob(canvas, format, minQuality);
    if (floor.size <= targetBytes) return { blob: floor, quality: minQuality, scale };
    scale *= 0.8;
  }

  // Give back the smallest we can produce.
  const w = Math.max(16, Math.round(img.naturalWidth * scale));
  const h = Math.max(16, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await canvasToBlob(canvas, format, minQuality);
  return { blob, quality: minQuality, scale };
}
