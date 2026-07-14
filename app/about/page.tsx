import type { Metadata } from "next";
import { ShieldCheck, Cpu, Wallet, Eye } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Toolbox processes everything in your browser — a privacy-first approach to media utilities.",
};

const points = [
  {
    icon: ShieldCheck,
    title: "Your files never leave your device",
    body: "Unlike most online converters, Toolbox never uploads your files to a server. All processing happens locally using your browser's own compute — powered by WebAssembly (ffmpeg.wasm), the Canvas API, and libraries like pdf-lib. Nothing is transmitted, stored, or logged.",
  },
  {
    icon: Cpu,
    title: "Real processing, in the browser",
    body: "Video and GIF conversions run on ffmpeg compiled to WebAssembly. PDFs are rebuilt with pdf-lib and rendered with pdf.js. Images are edited on the HTML canvas. The first heavy tool you open downloads its engine once, then caches it.",
  },
  {
    icon: Wallet,
    title: "Free, with no catch",
    body: "Because there's no server doing the work, there's no server cost to pass on to you. No accounts, no watermarks, no file-size paywalls, and no ads that track you. Just tools that work.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Privacy isn&apos;t a feature. It&apos;s the architecture.
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Toolbox is a collection of media utilities built on a single principle: your files are
        yours. Here&apos;s how that works.
      </p>

      <div className="mt-10 space-y-6">
        {points.map((p) => (
          <div
            key={p.title}
            className="flex gap-4 rounded-xl border border-border bg-card p-5 shadow-sm"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
              <p.icon className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold tracking-tight">{p.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-border bg-muted/40 p-5 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Eye className="size-4" />
          Open by design
        </p>
        <p className="mt-1.5 leading-relaxed">
          Everything is static and client-side. You can verify it yourself: open your browser&apos;s
          network tab while using any tool — you won&apos;t see your file being uploaded anywhere.
        </p>
      </div>
    </div>
  );
}
