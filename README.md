# Toolbox

A collection of free, fast, privacy-friendly media utilities. **All processing happens
client-side in your browser** — files never leave your device — so it deploys on
Vercel's free Hobby tier with zero server cost.

## Tools

**PDF** — Compress (rasterize to target size), Organize (merge / split / reorder / rotate),
Images → PDF.
**Image** — Editor (crop, resize, rotate, adjust, ID-photo presets), Compressor (target KB),
Converter (PNG/JPEG/WebP/AVIF, batch).
**Video / GIF** — Video → GIF (two-pass palette), GIF → Video (MP4/WebM), GIF → Images,
Video Compressor, Extract Audio.
**OCR** — Extract text from images/PDFs (Tesseract.js, runs entirely in-browser).

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- `next-themes` (light/dark), `framer-motion`, `lucide-react`, Geist fonts
- Client-side engines, all lazy-loaded per tool:
  - `@ffmpeg/ffmpeg` (ffmpeg.wasm, **single-threaded** core from unpkg CDN) — video/GIF/audio
  - `pdf-lib` + `pdfjs-dist` — PDF build/render
  - `gifuct-js` — GIF frame decoding
  - Canvas API — image editing/compression
  - `jszip` + `file-saver` — batch ZIP downloads

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## ⚠️ Build tooling: Turbopack is required

Both `dev` and `build` use **Turbopack** (`next dev/build --turbopack`). This is
deliberate: `pdfjs-dist` v5 ships ESM (`pdf.mjs`) that Next.js's **webpack** build
chokes on with `TypeError: Object.defineProperty called on non-object`. Turbopack
handles it cleanly. If you must use webpack, downgrade/patch pdfjs or pin an older
build — but Turbopack is the supported path here.

The pdf.js worker is served from `public/pdf.worker.min.mjs` (copied from
`pdfjs-dist/legacy/build`). If you upgrade `pdfjs-dist`, re-copy it:

```bash
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

## ffmpeg.wasm cross-origin isolation

We use the **single-threaded** core, which needs **no** COOP/COEP headers — simplest to
deploy. To switch to the multi-threaded core, uncomment the headers block in
`next.config.ts` and serve the core same-origin.

## Deploy

Push to Vercel with the **Next.js** preset — no env vars, no backend, no database.
Everything is static/client-side.
