import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-10 text-center sm:px-6 md:flex-row md:justify-between md:text-left">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-success" />
          <span>Every file is processed entirely in your browser. Nothing is uploaded.</span>
        </div>
        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Tools
          </Link>
          <Link href="/about" className="hover:text-foreground">
            About
          </Link>
          <span className="text-xs">© {new Date().getFullYear()} Toolbox</span>
        </div>
      </div>
    </footer>
  );
}
