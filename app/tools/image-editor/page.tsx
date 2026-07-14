"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Area, CropperProps } from "react-easy-crop";
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop as CropIcon,
  Layers,
  ImageDown,
  RefreshCw,
} from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import {
  DIMENSION_PRESETS,
  NEUTRAL_ADJUSTMENTS,
  LOSSY_FORMATS,
  FORMAT_MIME,
  loadImageFromBlob,
  renderToCanvas,
  canvasToBlob,
  getCroppedCanvas,
  fitCanvasToTarget,
  flipImageToCanvas,
  adjustmentsToFilter,
  type Adjustments,
  type ImageFormat,
  type DimensionPreset,
} from "@/lib/image";
import { zipBlobs } from "@/lib/zip";
import { FilenameField, buildFilename, sanitizeBaseName } from "@/components/shared/filename-field";
import { downloadBlob, formatBytes } from "@/lib/utils";

// Client-only. Cast to Partial props because react-easy-crop relies on
// defaultProps for most props, which the dynamic() wrapper doesn't surface.
const Cropper = dynamic(() => import("react-easy-crop"), {
  ssr: false,
}) as React.ComponentType<Partial<CropperProps>>;

interface QueueItem {
  id: string;
  file: File;
  url: string;
  img: HTMLImageElement;
}

const ASPECTS: { label: string; value: number | undefined }[] = [
  { label: "Free", value: undefined },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "3:2", value: 3 / 2 },
];

export default function ImageEditorPage() {
  const tool = getTool("image-editor")!;

  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Crop state
  const [aspect, setAspect] = React.useState<number | undefined>(undefined);
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedArea, setCroppedArea] = React.useState<Area | null>(null);

  // Transform
  const [rotate, setRotate] = React.useState(0);
  const [flipH, setFlipH] = React.useState(false);
  const [flipV, setFlipV] = React.useState(false);
  const [adjustments, setAdjustments] = React.useState<Adjustments>(NEUTRAL_ADJUSTMENTS);

  // Output
  const [resizeEnabled, setResizeEnabled] = React.useState(false);
  const [outWidth, setOutWidth] = React.useState(0);
  const [outHeight, setOutHeight] = React.useState(0);
  const [lockAspect, setLockAspect] = React.useState(true);
  const [fit, setFit] = React.useState<"cover" | "contain" | "stretch">("cover");
  const [background, setBackground] = React.useState("#ffffff");
  const [presetKey, setPresetKey] = React.useState("");
  const [format, setFormat] = React.useState<ImageFormat>("png");
  const [quality, setQuality] = React.useState(0.9);
  const [outName, setOutName] = React.useState("edited");

  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number | null; status: string } | null>(
    null
  );

  const active = queue.find((q) => q.id === activeId) ?? null;
  const isBatch = queue.length > 1;

  // The image the <Cropper> displays, with flips baked in so crop coordinates
  // stay correct. Adjustments are previewed live via CSS filter; rotation uses
  // react-easy-crop's native `rotation` prop. All three are re-applied on export.
  const [displayImg, setDisplayImg] = React.useState<HTMLImageElement | null>(null);
  const [displayUrl, setDisplayUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!active) {
      setDisplayImg(null);
      setDisplayUrl(null);
      return;
    }
    if (!flipH && !flipV) {
      setDisplayImg(active.img);
      setDisplayUrl(active.url);
      return;
    }
    let revoked = false;
    let url: string | null = null;
    const canvas = flipImageToCanvas(active.img, flipH, flipV);
    canvas.toBlob((blob) => {
      if (!blob || revoked) return;
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (revoked) URL.revokeObjectURL(url!);
        else {
          setDisplayImg(img);
          setDisplayUrl(url);
        }
      };
      img.src = url;
    }, "image/png");
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, flipH, flipV]);

  const onFiles = React.useCallback(
    async (files: File[]) => {
      setError(null);
      try {
        const items = await Promise.all(
          files.map(async (file) => {
            const img = await loadImageFromBlob(file);
            // loadImageFromBlob revokes its own object URL after decoding, so mint
            // a fresh persistent one for the <Cropper>/thumbnail <img> previews.
            return {
              id: `${file.name}-${crypto.randomUUID()}`,
              file,
              url: URL.createObjectURL(file),
              img,
            } as QueueItem;
          })
        );
        setQueue((prev) => {
          prev.forEach((p) => URL.revokeObjectURL(p.url));
          return items;
        });
        setActiveId(items[0]?.id ?? null);
        setOutName(items.length === 1 ? `${sanitizeBaseName(items[0].file.name)}-edited` : "edited-images");
        const first = items[0]?.img;
        if (first) {
          setOutWidth(first.naturalWidth);
          setOutHeight(first.naturalHeight);
        }
        // reset transforms
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setRotate(0);
        setFlipH(false);
        setFlipV(false);
        setAdjustments(NEUTRAL_ADJUSTMENTS);
        setResizeEnabled(false);
        setPresetKey("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load images.");
      }
    },
    []
  );

  function applyPreset(key: string) {
    setPresetKey(key);
    if (!key) return;
    const preset = DIMENSION_PRESETS.find((p) => `${p.group}:${p.label}` === key);
    if (!preset) return;
    setResizeEnabled(true);
    setOutWidth(preset.width);
    setOutHeight(preset.height);
    setFit("contain");
    if (preset.background) setBackground(preset.background);
  }

  function updateWidth(w: number) {
    setOutWidth(w);
    if (lockAspect && active) {
      const ratio = active.img.naturalHeight / active.img.naturalWidth;
      setOutHeight(Math.round(w * ratio));
    }
    setPresetKey("");
  }
  function updateHeight(h: number) {
    setOutHeight(h);
    if (lockAspect && active) {
      const ratio = active.img.naturalWidth / active.img.naturalHeight;
      setOutWidth(Math.round(h * ratio));
    }
    setPresetKey("");
  }

  function buildRenderOptions(item: QueueItem, useCrop: boolean) {
    const cropRect =
      useCrop && croppedArea
        ? {
            x: croppedArea.x,
            y: croppedArea.y,
            width: croppedArea.width,
            height: croppedArea.height,
          }
        : undefined;
    return {
      crop: cropRect,
      rotate,
      flipH,
      flipV,
      adjustments,
      targetWidth: resizeEnabled ? outWidth : undefined,
      targetHeight: resizeEnabled ? outHeight : undefined,
      fit,
      background: fit === "contain" || format === "jpeg" ? background : undefined,
    };
  }

  async function exportActive() {
    if (!active || !displayImg) return;
    setBusy(true);
    setError(null);
    setProgress({ value: null, status: "Rendering…" });
    try {
      // Flip is already baked into displayImg; rotation + crop + adjustments are
      // applied here to exactly match what the cropper shows.
      const area = croppedArea ?? {
        x: 0,
        y: 0,
        width: displayImg.naturalWidth,
        height: displayImg.naturalHeight,
      };
      let canvas = getCroppedCanvas(displayImg, area, rotate, adjustmentsToFilter(adjustments));
      const bg = fit === "contain" || format === "jpeg" ? background : undefined;
      if (resizeEnabled) {
        canvas = fitCanvasToTarget(canvas, outWidth, outHeight, fit, bg);
      } else if (format === "jpeg") {
        // JPEG has no alpha — flatten onto the background.
        canvas = fitCanvasToTarget(canvas, canvas.width, canvas.height, "stretch", bg);
      }
      const blob = await canvasToBlob(
        canvas,
        format,
        LOSSY_FORMATS.includes(format) ? quality : undefined
      );
      if (blob.type !== FORMAT_MIME[format]) {
        setError(
          `Your browser can't encode ${format.toUpperCase()}. Try PNG, JPEG or WebP instead.`
        );
        return;
      }
      downloadBlob(blob, buildFilename(outName, format, "edited"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function exportBatch() {
    if (!queue.length) return;
    setBusy(true);
    setError(null);
    try {
      const entries = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setProgress({
          value: (i / queue.length) * 100,
          status: `Processing ${i + 1} of ${queue.length}…`,
        });
        // Batch can't reuse a single crop rect across differently-sized images,
        // so crop is skipped in batch — resize/fit/adjust/rotate still apply.
        const canvas = renderToCanvas(item.img, buildRenderOptions(item, false));
        const blob = await canvasToBlob(
          canvas,
          format,
          LOSSY_FORMATS.includes(format) ? quality : undefined
        );
        entries.push({ name: `${sanitizeBaseName(item.file.name)}.${format}`, blob });
      }
      setProgress({ value: 100, status: "Zipping…" });
      const zip = await zipBlobs(entries);
      downloadBlob(zip, buildFilename(outName, "zip", "edited-images"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch export failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function reset() {
    setQueue((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setActiveId(null);
    setError(null);
    setCroppedArea(null);
  }

  return (
    <ToolShell tool={tool}>
      {queue.length === 0 ? (
        <Dropzone
          accept="image/*"
          multiple
          onFiles={onFiles}
          title="Drop image(s) to edit"
          hint="PNG, JPEG, WebP, AVIF, GIF · one for full editing, several for batch"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Canvas / crop area */}
          <div className="flex flex-col gap-3">
            <div
              className="crop-stage relative h-[360px] w-full overflow-hidden rounded-xl border border-border bg-muted sm:h-[460px]"
              style={{ "--crop-filter": adjustmentsToFilter(adjustments) } as React.CSSProperties}
            >
              {active && displayUrl && (
                <Cropper
                  image={displayUrl}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotate}
                  aspect={aspect ?? active.img.naturalWidth / active.img.naturalHeight}
                  restrictPosition={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, areaPixels) => setCroppedArea(areaPixels)}
                  objectFit="contain"
                />
              )}
            </div>

            <div className="flex items-center gap-3">
              <CropIcon className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Zoom</span>
              <Slider value={zoom} min={1} max={4} step={0.01} onChange={setZoom} />
            </div>

            {isBatch && (
              <div className="flex gap-2 overflow-x-auto scroll-thin pb-1">
                {queue.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setActiveId(q.id)}
                    className={`relative size-16 shrink-0 overflow-hidden rounded-md border-2 ${
                      q.id === activeId ? "border-accent" : "border-transparent"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={q.url} alt={q.file.name} className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-5">
            {/* Aspect */}
            <section>
              <Label className="mb-2 block">Crop aspect ratio</Label>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map((a) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={aspect === a.value ? "default" : "outline"}
                    onClick={() => setAspect(a.value)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </section>

            {/* Rotate / flip */}
            <section>
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
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-16">Fine {rotate}°</span>
                <Slider value={rotate} min={0} max={359} step={1} onChange={setRotate} />
              </div>
            </section>

            {/* Adjustments */}
            <section className="space-y-2">
              <Label className="block">Adjustments</Label>
              {(["brightness", "contrast", "saturation"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2 text-sm">
                  <span className="w-20 capitalize text-muted-foreground">{k}</span>
                  <Slider
                    value={adjustments[k]}
                    min={0}
                    max={200}
                    onChange={(v) => setAdjustments((a) => ({ ...a, [k]: v }))}
                  />
                  <span className="w-8 text-right font-mono text-xs">{adjustments[k]}</span>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setAdjustments(NEUTRAL_ADJUSTMENTS)}>
                Reset adjustments
              </Button>
            </section>

            {/* Resize / presets */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="resize-toggle">Resize output</Label>
                <Switch id="resize-toggle" checked={resizeEnabled} onCheckedChange={setResizeEnabled} />
              </div>

              <Select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Custom size…</option>
                {Array.from(new Set(DIMENSION_PRESETS.map((p) => p.group))).map((group) => (
                  <optgroup key={group} label={group}>
                    {DIMENSION_PRESETS.filter((p) => p.group === group).map((p: DimensionPreset) => (
                      <option key={p.label} value={`${p.group}:${p.label}`}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>

              {resizeEnabled && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Label className="mb-1 block text-xs text-muted-foreground">Width (px)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={outWidth}
                        onChange={(e) => updateWidth(Number(e.target.value))}
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="mb-1 block text-xs text-muted-foreground">Height (px)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={outHeight}
                        onChange={(e) => updateHeight(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={lockAspect} onCheckedChange={setLockAspect} />
                    Maintain aspect ratio
                  </label>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">Fit mode</Label>
                    <Select value={fit} onChange={(e) => setFit(e.target.value as typeof fit)}>
                      <option value="cover">Cover (crop to fill)</option>
                      <option value="contain">Contain (pad with background)</option>
                      <option value="stretch">Stretch</option>
                    </Select>
                  </div>
                </>
              )}
            </section>

            {/* Export options */}
            <section className="space-y-3">
              <Label className="block">Export</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Label className="mb-1 block text-xs text-muted-foreground">Format</Label>
                  <Select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                    <option value="avif">AVIF</option>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Background</Label>
                  <input
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border border-input bg-card"
                    aria-label="Background fill color"
                  />
                </div>
              </div>
              {LOSSY_FORMATS.includes(format) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-muted-foreground">Quality</span>
                  <Slider value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} />
                  <span className="w-10 text-right font-mono text-xs">{Math.round(quality * 100)}%</span>
                </div>
              )}
            </section>

            <FilenameField
              value={outName}
              onChange={setOutName}
              extension={format}
              label={isBatch ? "Current image file name" : "Output file name"}
            />

            {progress && <ProgressBar value={progress.value} status={progress.status} />}
            {error && <ErrorAlert message={error} />}

            <div className="flex flex-col gap-2">
              <Button onClick={exportActive} disabled={busy}>
                <ImageDown className="size-4" />
                {isBatch ? "Download current image" : "Download"}
              </Button>
              {isBatch && (
                <Button variant="secondary" onClick={exportBatch} disabled={busy}>
                  <Layers className="size-4" />
                  Apply to all &amp; download ZIP ({queue.length})
                </Button>
              )}
              <Button variant="ghost" onClick={reset} disabled={busy}>
                <RefreshCw className="size-4" />
                Start over
              </Button>
            </div>

            {active && (
              <p className="text-xs text-muted-foreground">
                Source: {active.img.naturalWidth}×{active.img.naturalHeight}px ·{" "}
                {formatBytes(active.file.size)}
                {isBatch && " · crop is skipped in batch mode"}
              </p>
            )}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
