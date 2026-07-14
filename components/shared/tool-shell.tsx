import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Tool } from "@/lib/tools";
import { PrivacyNote } from "@/components/shared/privacy-note";

interface ToolShellProps {
  tool: Tool;
  children: React.ReactNode;
}

export function ToolShell({ tool, children }: ToolShellProps) {
  const Icon = tool.icon;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All tools
      </Link>

      <div className="mb-8 flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
          <Icon className="size-6" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{tool.name}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tool.category}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{tool.description}</p>
        </div>
      </div>

      {children}

      <PrivacyNote className="mt-10" />
    </div>
  );
}
