import crypto from "node:crypto";

// Everything secret-derived comes from the existing JWT secrets so Render
// needs no new env var; MFA_ENCRYPTION_KEY can override it later.
function baseSecret(): string {
  return process.env.MFA_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
}

function key(purpose: string): Buffer {
  return crypto.createHash("sha256").update(`pestapp:${purpose}:${baseSecret()}`).digest();
}

// AES-256-GCM: the stored value is base64(iv | tag | ciphertext).
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("totp"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("totp"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// Keyed hash for short codes (SMS codes, recovery codes): a plain hash of a
// 6-digit number is trivially reversible, so mix in a server-side key.
export function hashCode(code: string): string {
  return crypto.createHmac("sha256", key("code")).update(code.trim().toLowerCase()).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomDigits(length: number): string {
  let out = "";
  while (out.length < length) out += crypto.randomInt(0, 10).toString();
  return out;
}

const READABLE = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
// Unambiguous characters only (no 0/O, 1/l/I) so a password read aloud or
// typed from a screen is not misread.
export function randomReadable(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += READABLE[crypto.randomInt(0, READABLE.length)];
  return out;
}
