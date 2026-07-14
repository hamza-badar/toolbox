import JSZip from "jszip";

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** Bundle blobs into a single ZIP Blob. */
export async function zipBlobs(entries: ZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  // De-duplicate names to avoid clobbering inside the archive.
  const seen = new Map<string, number>();
  for (const entry of entries) {
    let name = entry.name;
    const count = seen.get(name) ?? 0;
    if (count > 0) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`;
    }
    seen.set(entry.name, count + 1);
    zip.file(name, entry.blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
