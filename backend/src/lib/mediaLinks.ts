import jwt from "jsonwebtoken";

// Links that let a customer open a photo from the emailed PDF report at full
// size without an account. Each link is signed (nobody can make one up or
// change it to reach another file), only ever opens inspection photos, and
// stops working after REPORT_LINK_DAYS (default one year).
const SECRET = `${process.env.JWT_ACCESS_SECRET || "dev-access-secret"}:media-link`;
const DAYS = Number(process.env.REPORT_LINK_DAYS || 365);

// Only the photos taken during an inspection - never signatures, reports or site plans.
export function isShareablePhotoKey(key: string): boolean {
  return (key.startsWith("photos/") || key.startsWith("checklist-photos/")) && !key.includes("..");
}

export function signPhotoLink(key: string): string {
  return jwt.sign({ k: key }, SECRET, { expiresIn: `${DAYS}d` });
}

export function verifyPhotoLink(token: string): string | null {
  try {
    const payload = jwt.verify(token, SECRET) as { k?: unknown };
    return typeof payload.k === "string" && isShareablePhotoKey(payload.k) ? payload.k : null;
  } catch {
    return null;
  }
}
