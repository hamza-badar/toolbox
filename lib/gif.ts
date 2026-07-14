// GIF frame extraction via gifuct-js. Frames are decoded as patches, then
// composited onto a full-size canvas respecting disposal so each exported
// frame is a complete image.

export interface GifFrame {
  index: number;
  delayMs: number;
  canvas: HTMLCanvasElement;
}

export async function decodeGifFrames(file: File): Promise<GifFrame[]> {
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  if (!frames.length) throw new Error("No frames found — this may not be a valid GIF.");

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  // Full-size composite canvas carried across frames.
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const fctx = full.getContext("2d")!;

  // Reusable temp canvas for drawing each frame's patch.
  const temp = document.createElement("canvas");
  const tctx = temp.getContext("2d")!;

  const out: GifFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const { width: fw, height: fh, top, left } = frame.dims;

    temp.width = fw;
    temp.height = fh;
    const imageData = new ImageData(new Uint8ClampedArray(frame.patch), fw, fh);
    tctx.putImageData(imageData, 0, 0);

    // Composite the patch over the running full frame (respects transparency).
    fctx.drawImage(temp, left, top);

    // Snapshot the current full frame.
    const snap = document.createElement("canvas");
    snap.width = width;
    snap.height = height;
    snap.getContext("2d")!.drawImage(full, 0, 0);

    out.push({
      index: i,
      delayMs: frame.delay ?? 100,
      canvas: snap,
    });

    // Disposal method 2 = restore the frame's region to background (clear it).
    if (frame.disposalType === 2) {
      fctx.clearRect(left, top, fw, fh);
    }
  }

  return out;
}
