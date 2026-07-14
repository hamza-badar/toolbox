"use client";

import { Download } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { downloadBlob } from "@/lib/utils";

interface DownloadButtonProps extends Omit<ButtonProps, "onClick"> {
  blob: Blob;
  filename: string;
  label?: string;
}

export function DownloadButton({
  blob,
  filename,
  label = "Download",
  ...props
}: DownloadButtonProps) {
  return (
    <Button onClick={() => downloadBlob(blob, filename)} {...props}>
      <Download className="size-4" />
      {label}
    </Button>
  );
}
