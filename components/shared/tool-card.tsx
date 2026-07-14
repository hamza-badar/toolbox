"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { getTool } from "@/lib/tools";

export function ToolCard({ slug, index = 0 }: { slug: string; index?: number }) {
  const tool = getTool(slug);
  if (!tool) return null;
  const Icon = tool.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Link
        href={`/tools/${tool.slug}`}
        className="group relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between">
          <span className="flex size-11 items-center justify-center rounded-lg bg-accent-muted text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
            <Icon className="size-5" />
          </span>
          <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div>
          <h3 className="flex items-center gap-2 font-semibold tracking-tight">
            {tool.name}
            {tool.heavy && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                wasm
              </span>
            )}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
        </div>
      </Link>
    </motion.div>
  );
}
