import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // We build with Turbopack (dev + build). Turbopack handles pdfjs-dist's ESM
  // cleanly, where webpack trips over pdf.mjs. Alias the optional Node "canvas"
  // dependency to an empty stub since we only ever render on the client.
  turbopack: {
    resolveAlias: {
      canvas: path.resolve(__dirname, "lib/empty-module.js"),
    },
  },

  // NOTE: We use the SINGLE-THREADED ffmpeg.wasm core loaded from a CDN, which
  // does NOT require cross-origin isolation. If you switch to the multi-threaded
  // core, add the COOP/COEP headers below (and serve the core same-origin) to
  // enable SharedArrayBuffer.
  //
  // async headers() {
  //   return [
  //     {
  //       source: "/(.*)",
  //       headers: [
  //         { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  //         { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  //       ],
  //     },
  //   ];
  // },
};

export default nextConfig;
