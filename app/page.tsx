import { ShieldCheck, Zap, WifiOff } from "lucide-react";
import { categories, toolsByCategory } from "@/lib/tools";
import { ToolCard } from "@/components/shared/tool-card";

const perks = [
  { icon: ShieldCheck, label: "100% private", note: "Files never leave your device" },
  { icon: Zap, label: "Fast & free", note: "No sign-up, no limits, no watermarks" },
  { icon: WifiOff, label: "Works offline", note: "All processing runs in your browser" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="aurora relative overflow-hidden border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-success" />
            Client-side only — nothing is uploaded
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Free media tools that{" "}
            <span className="text-accent">respect your privacy</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
            Compress PDFs, edit images, and convert video to GIF — all processed right here in
            your browser. No uploads, no accounts, no cost.
          </p>

          <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
            {perks.map((p) => (
              <div
                key={p.label}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card/60 p-4 backdrop-blur"
              >
                <p.icon className="size-5 text-accent" />
                <span className="text-sm font-semibold">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tool grid, grouped by category */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {categories.map((category) => {
          const list = toolsByCategory(category);
          return (
            <div key={category} className="mb-14 last:mb-0">
              <div className="mb-5 flex items-baseline justify-between">
                <h2 className="text-xl font-semibold tracking-tight">{category}</h2>
                <span className="text-sm text-muted-foreground">
                  {list.length} tool{list.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((tool, i) => (
                  <ToolCard key={tool.slug} slug={tool.slug} index={i} />
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
