"use client";

import * as React from "react";
import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Check, X, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  loadImageFromBlob,
  bakeOrientation,
  perspectiveCrop,
  buildColorFilter,
  NEUTRAL_ADJUSTMENTS,
  type Adjustments,
  type ColorMode,
  type Point,
} from "@/lib/image";

export interface ImageEdits {
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  colorMode: ColorMode;
  adjustments: Adjustments;
  corners?: Point[];
}

export const DEFAULT_EDITS: ImageEdits = {
  rotate: 0,
  flipH: false,
  flipV: false,
  colorMode: "original",
  adjustments: NEUTRAL_ADJUSTMENTS,
  corners: undefined,
};

const FULL_CORNERS: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const COLOR_PRESETS: { mode: ColorMode; label: string }[] = [
  { mode: "original", label: "Original" },
  { mode: "color", label: "Colour" },
  { mode: "bw", label: "B&W" },
  { mode: "grayscale", label: "Greyscale" },
  { mode: "save-ink", label: "Save ink" },
];

/** Diameter (px) of the magnifier loupe shown while dragging a corner handle. */
const MAGNIFIER_SIZE = 120;
const MAGNIFIER_ZOOM = 2.75;

const ASPECT_PRESETS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "A4", ratio: 210 / 297 },
];

/** Centered rectangle (as 4 corners) for a target aspect ratio, inset 6%. */
function rectCornersForAspect(ratio: number | null, imgAspect: number): Point[] {
  if (!ratio) return FULL_CORNERS;
  const inset = 0.06;
  let w = 1 - inset * 2;
  let h = 1 - inset * 2;
  const targetImgRatio = ratio / imgAspect; // desired width/height in normalized image space
  if (targetImgRatio > w / h) {
    h = w / targetImgRatio;
  } else {
    w = h * targetImgRatio;
  }
  const x0 = (1 - w) / 2;
  const y0 = (1 - h) / 2;
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
}

interface Props {
  /** The pristine source image to edit (edits always apply from the original). */
  file: File;
  initialEdits?: ImageEdits;
  onApply: (result: { blob: Blob; edits: ImageEdits }) => void;
  onClose: () => void;
}

export function ImageEditDialog({ file, initialEdits, onApply, onClose }: Props) {
  const start = initialEdits ?? DEFAULT_EDITS;
  const [srcImg, setSrcImg] = React.useState<HTMLImageElement | null>(null);
  const [displayImg, setDisplayImg] = React.useState<HTMLImageElement | null>(null);
  const [displayUrl, setDisplayUrl] = React.useState<string | null>(null);

  const [rotate, setRotate] = React.useState(start.rotate);
  const [flipH, setFlipH] = React.useState(start.flipH);
  const [flipV, setFlipV] = React.useState(start.flipV);
  const [colorMode, setColorMode] = React.useState<ColorMode>(start.colorMode);
  const [adjustments, setAdjustments] = React.useState<Adjustments>(start.adjustments);
  const [corners, setCorners] = React.useState<Point[]>(start.corners ?? FULL_CORNERS);
  const [aspectLabel, setAspectLabel] = React.useState("Free");
  const [busy, setBusy] = React.useState(false);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 });
  const dragIndex = React.useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);

  // Load the source image once.
  React.useEffect(() => {
    let alive = true;
    loadImageFromBlob(file).then((img) => alive && setSrcImg(img));
    return () => {
      alive = false;
    };
  }, [file]);

  // Bake 90°-rotation + flips into the image the cropper displays, so corner
  // coordinates always refer to the correctly-oriented image.
  React.useEffect(() => {
    if (!srcImg) return;
    let revoked = false;
    let url: string | null = null;
    const canvas = bakeOrientation(srcImg, rotate, flipH, flipV);
    canvas.toBlob((blob) => {
      if (!blob || revoked) return;
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (revoked) {
          URL.revokeObjectURL(url!);
          return;
        }
        setDisplayImg(img);
        setDisplayUrl(url);
      };
      img.src = url;
    }, "image/png");
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [srcImg, rotate, flipH, flipV]);

  // Size the stage to the image's own aspect ratio, bounded by available space
  // — this is what makes a portrait ID card render tall instead of squashed
  // into a fixed wide box.
  React.useEffect(() => {
    if (!displayImg) return;
    const compute = () => {
      const wrapper = stageRef.current?.parentElement;
      const maxW = wrapper ? wrapper.clientWidth : 480;
      const maxH = Math.min(window.innerHeight * 0.5, 520);
      const imgAspect = displayImg.naturalWidth / displayImg.naturalHeight;
      let w = maxW;
      let h = w / imgAspect;
      if (h > maxH) {
        h = maxH;
        w = h * imgAspect;
      }
      setStageSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [displayImg]);

  const filter = buildColorFilter(colorMode, adjustments);

  function chooseAspect(label: string, ratio: number | null) {
    setAspectLabel(label);
    if (!displayImg) return;
    const imgAspect = displayImg.naturalWidth / displayImg.naturalHeight;
    setCorners(rectCornersForAspect(ratio, imgAspect));
  }

  function pointFromEvent(e: PointerEvent | React.PointerEvent): Point {
    const rect = stageRef.current!.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))];
  }

  function startDrag(i: number, e: React.PointerEvent) {
    e.preventDefault();
    dragIndex.current = i;
    setDraggingIndex(i);
    setAspectLabel("Free"); // any manual drag breaks a locked ratio
    const move = (ev: PointerEvent) => {
      if (dragIndex.current === null) return;
      const p = pointFromEvent(ev);
      setCorners((prev) => {
        const next = [...prev];
        next[dragIndex.current!] = p;
        return next;
      });
    };
    const up = () => {
      dragIndex.current = null;
      setDraggingIndex(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function apply() {
    if (!displayImg) return;
    setBusy(true);
    try {
      const canvas = perspectiveCrop(displayImg, corners, filter);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
      );
      onApply({ blob, edits: { rotate, flipH, flipV, colorMode, adjustments, corners } });
    } finally {
      setBusy(false);
    }
  }

  const handleLabels = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const polygonPoints = corners
    .map(([x, y]) => `${(x * stageSize.w).toFixed(1)},${(y * stageSize.h).toFixed(1)}`)
    .join(" ");
  // Outer rect minus the crop quad, used to dim everything outside the selection.
  const maskId = React.useId();

  // Magnifier loupe: zooms in on the corner being dragged so the fingertip
  // (which covers the actual point on touch devices) doesn't block the view.
  // Positioned in the quadrant opposite the point so it never sits under it.
  let magnifier: { left: number; top: number; bgX: number; bgY: number } | null = null;
  if (draggingIndex !== null && stageSize.w > 0 && stageSize.h > 0) {
    const [nx, ny] = corners[draggingIndex];
    const px = nx * stageSize.w;
    const py = ny * stageSize.h;
    const clear = MAGNIFIER_SIZE / 2 + 24;
    const rawLeft = px + (nx < 0.5 ? clear : -clear);
    const rawTop = py + (ny < 0.5 ? clear : -clear);
    const half = MAGNIFIER_SIZE / 2;
    const left = Math.max(half, Math.min(stageSize.w - half, rawLeft));
    const top = Math.max(half, Math.min(stageSize.h - half, rawTop));
    magnifier = {
      left,
      top,
      bgX: -(px * MAGNIFIER_ZOOM - half),
      bgY: -(py * MAGNIFIER_ZOOM - half),
    };
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-semibold">Edit image</h2>
            <p className="text-xs text-muted-foreground">
              Drag any corner independently — like a document scanner.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden md:grid md:grid-cols-[1fr_240px] md:gap-5 md:overflow-y-auto md:p-5 md:scroll-thin">
          {/* Crop area — sized to the image's own aspect ratio. Pinned in
              place on mobile (not part of the scroll) so it stays visible
              while you scroll the controls panel below to tweak a setting. */}
          <div className="flex shrink-0 items-center justify-center p-3">
            {displayUrl && stageSize.w > 0 && (
              <div
                ref={stageRef}
                className="relative touch-none select-none"
                style={{ width: stageSize.w, height: stageSize.h }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayUrl}
                  alt="Edit preview"
                  className="pointer-events-none block h-full w-full rounded-md"
                  style={{ filter }}
                  draggable={false}
                />

                {/* Dim everything outside the crop quad. */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${stageSize.w} ${stageSize.h}`}
                >
                  <defs>
                    <mask id={maskId}>
                      <rect x={0} y={0} width={stageSize.w} height={stageSize.h} fill="white" />
                      <polygon points={polygonPoints} fill="black" />
                    </mask>
                  </defs>
                  <rect
                    x={0}
                    y={0}
                    width={stageSize.w}
                    height={stageSize.h}
                    fill="black"
                    fillOpacity={0.55}
                    mask={`url(#${maskId})`}
                  />
                  <polygon
                    points={polygonPoints}
                    fill="none"
                    stroke="white"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                  />
                </svg>

                {/* Independently draggable corner handles. */}
                {corners.map(([x, y], i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Drag ${handleLabels[i]} corner`}
                    onPointerDown={(e) => startDrag(i, e)}
                    className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-accent bg-card shadow-md active:cursor-grabbing"
                    style={{ left: x * stageSize.w, top: y * stageSize.h }}
                  />
                ))}

                {/* Zoomed loupe preview of the corner currently being dragged. */}
                {magnifier && displayUrl && (
                  <div
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-white shadow-lg"
                    style={{
                      left: magnifier.left,
                      top: magnifier.top,
                      width: MAGNIFIER_SIZE,
                      height: MAGNIFIER_SIZE,
                      backgroundImage: `url(${displayUrl})`,
                      backgroundRepeat: "no-repeat",
                      backgroundSize: `${stageSize.w * MAGNIFIER_ZOOM}px ${stageSize.h * MAGNIFIER_ZOOM}px`,
                      backgroundPosition: `${magnifier.bgX}px ${magnifier.bgY}px`,
                      filter,
                    }}
                  >
                    {/* Crosshair marking the exact point, since the finger/cursor hides it on the stage itself. */}
                    <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-accent" />
                    <div className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-accent" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls — scrolls independently on mobile so the pinned
              preview above never has to be scrolled past to reach them. */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-thin p-5 pt-0 md:flex-none md:overflow-visible md:p-0">
            <div>
              <Label className="mb-2 block">Crop ratio</Label>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_PRESETS.map((a) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={aspectLabel === a.label ? "default" : "outline"}
                    onClick={() => chooseAspect(a.label, a.ratio)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1.5"
                onClick={() => {
                  setCorners(FULL_CORNERS);
                  setAspectLabel("Free");
                }}
              >
                <Maximize className="size-4" />
                Reset crop to full
              </Button>
            </div>

            <div>
              <Label className="mb-2 block">Rotate &amp; flip</Label>
              <div className="flex flex-wrap gap-1.5">
                <Button size="icon" variant="outline" aria-label="Rotate left" onClick={() => setRotate((r) => (r - 90 + 360) % 360)}>
                  <RotateCcw />
                </Button>
                <Button size="icon" variant="outline" aria-label="Rotate right" onClick={() => setRotate((r) => (r + 90) % 360)}>
                  <RotateCw />
                </Button>
                <Button size="icon" variant={flipH ? "default" : "outline"} aria-label="Flip horizontal" onClick={() => setFlipH((v) => !v)}>
                  <FlipHorizontal />
                </Button>
                <Button size="icon" variant={flipV ? "default" : "outline"} aria-label="Flip vertical" onClick={() => setFlipV((v) => !v)}>
                  <FlipVertical />
                </Button>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.mode}
                    type="button"
                    onClick={() => setColorMode(preset.mode)}
                    className={`flex w-14 flex-col items-center gap-1 rounded-md p-1 text-[11px] transition-colors ${
                      colorMode === preset.mode
                        ? "bg-accent/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`flex size-12 items-center justify-center overflow-hidden rounded-md border-2 bg-muted ${
                        colorMode === preset.mode ? "border-accent" : "border-transparent"
                      }`}
                    >
                      {displayUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={displayUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          style={{ filter: buildColorFilter(preset.mode, NEUTRAL_ADJUSTMENTS) }}
                          draggable={false}
                        />
                      ) : null}
                    </span>
                    <span className="text-center leading-tight">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {(["brightness", "contrast", "saturation"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2 text-sm">
                  <span className="w-20 capitalize text-muted-foreground">{k}</span>
                  <Slider
                    value={adjustments[k]}
                    min={0}
                    max={200}
                    disabled={k === "saturation" && colorMode !== "original" && colorMode !== "color"}
                    onChange={(v) => setAdjustments((a) => ({ ...a, [k]: v }))}
                  />
                  <span className="w-8 text-right font-mono text-xs">{adjustments[k]}</span>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdjustments(NEUTRAL_ADJUSTMENTS);
                  setColorMode("original");
                  setRotate(0);
                  setFlipH(false);
                  setFlipV(false);
                }}
              >
                Reset adjustments
              </Button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={busy || !displayImg}>
            <Check className="size-4" />
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
