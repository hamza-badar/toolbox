import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorAlertProps {
  title?: string;
  message: string;
  className?: string;
}

export function ErrorAlert({ title = "Something went wrong", message, className }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div>
        <p className="font-medium text-destructive">{title}</p>
        <p className="mt-0.5 text-foreground/80">{message}</p>
      </div>
    </div>
  );
}
