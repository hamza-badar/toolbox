import type { LucideIcon } from "lucide-react";
import {
  FileText,
  FileStack,
  FileImage,
  Images,
  Crop,
  Minimize2,
  Repeat,
  Film,
  Video,
  ImageDown,
  Clapperboard,
  AudioLines,
  ScanText,
} from "lucide-react";

export type ToolCategory = "PDF" | "Image" | "Video/GIF";

export interface Tool {
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  /** ffmpeg.wasm tools are heavier — flag for a small badge. */
  heavy?: boolean;
}

export const tools: Tool[] = [
  // ---------- PDF ----------
  {
    slug: "pdf-compress",
    name: "PDF Compressor",
    description: "Shrink a PDF to a target file size, right in your browser.",
    category: "PDF",
    icon: FileText,
  },
  {
    slug: "pdf-organize",
    name: "PDF Organize",
    description: "Merge, split, reorder and rotate PDF pages visually.",
    category: "PDF",
    icon: FileStack,
  },
  {
    slug: "image-to-pdf",
    name: "Images → PDF",
    description: "Combine images into a single PDF with page & margin options.",
    category: "PDF",
    icon: FileImage,
  },
  {
    slug: "ocr",
    name: "OCR — Extract Text",
    description: "Pull selectable text out of scanned PDFs or images.",
    category: "PDF",
    icon: ScanText,
    heavy: true,
  },
  // ---------- Image ----------
  {
    slug: "image-editor",
    name: "Image Editor",
    description: "Crop, resize, rotate, adjust and export — with ID-photo presets.",
    category: "Image",
    icon: Crop,
  },
  {
    slug: "image-compress",
    name: "Image Compressor",
    description: "Compress JPEG/PNG/WebP down to a target KB size.",
    category: "Image",
    icon: Minimize2,
  },
  {
    slug: "image-convert",
    name: "Image Converter",
    description: "Convert between PNG, JPEG, WebP & AVIF in batch.",
    category: "Image",
    icon: Repeat,
  },
  // ---------- Video / GIF ----------
  {
    slug: "video-to-gif",
    name: "Video → GIF",
    description: "Trim any video into a high-quality GIF with palette optimization.",
    category: "Video/GIF",
    icon: Film,
    heavy: true,
  },
  {
    slug: "gif-to-video",
    name: "GIF → Video",
    description: "Convert GIFs to compact MP4 or WebM.",
    category: "Video/GIF",
    icon: Video,
    heavy: true,
  },
  {
    slug: "gif-to-image",
    name: "GIF → Images",
    description: "Extract every frame of a GIF as PNG, JPEG or WebP.",
    category: "Video/GIF",
    icon: Images,
    heavy: true,
  },
  {
    slug: "video-to-image",
    name: "Video → Images",
    description: "Extract every frame of a video as PNG, JPEG or WebP in a ZIP.",
    category: "Video/GIF",
    icon: ImageDown,
    heavy: true,
  },
  {
    slug: "video-compress",
    name: "Video Compressor",
    description: "Trim & re-encode video to a smaller size or bitrate.",
    category: "Video/GIF",
    icon: Clapperboard,
    heavy: true,
  },
  {
    slug: "video-to-audio",
    name: "Extract Audio",
    description: "Pull the audio track from a video as MP3, WAV or AAC.",
    category: "Video/GIF",
    icon: AudioLines,
    heavy: true,
  },
];

export const categories: ToolCategory[] = ["PDF", "Image", "Video/GIF"];

export function getTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}

export function toolsByCategory(category: ToolCategory): Tool[] {
  return tools.filter((t) => t.category === category);
}
