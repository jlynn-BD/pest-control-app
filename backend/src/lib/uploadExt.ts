import path from "node:path";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"]);

// The file extension decides how a stored file is served back (see
// storage.ts), and the upload's own filename is whatever the sender chose, so
// only known photo extensions are kept; anything else is stored as a JPEG
// name instead of a name like ".html" or ".svg".
export function photoExt(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return IMAGE_EXTS.has(ext) ? ext : ".jpg";
}

// For the generic upload endpoint, which also accepts PDFs: unknown
// extensions are dropped (such files are always served as a plain download).
export function documentExt(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return IMAGE_EXTS.has(ext) || ext === ".pdf" ? ext : "";
}
