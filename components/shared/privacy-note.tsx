import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function PrivacyNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-2 text-xs text-muted-foreground",
        className
      )}
    >
      <Lock className="size-3.5 text-success" />
      Your files never leave your browser — everything runs on your device.
    </p>
  );
}
