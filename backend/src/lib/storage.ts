import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";

const LEGACY_STORAGE_DIR = path.resolve(process.cwd(), process.env.STORAGE_DIR || "./storage");

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  save(buffer: Buffer, key: string): Promise<string>;
  read(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function safeKey(key: string): string {
  return path.normalize(key).replace(/^(\.\.[/\\])+/, "");
}

// Files live in Postgres (StoredFile), so they survive redeploys and
// restarts exactly like the rest of the data. Anything still sitting on the
// old on-disk folder is served from there and copied into the database the
// first time it's read, so nothing that survived is stranded.
class DatabaseStorageAdapter implements StorageAdapter {
  async save(buffer: Buffer, key: string): Promise<string> {
    const k = safeKey(key);
    const contentType = contentTypeFor(k);
    await prisma.storedFile.upsert({
      where: { key: k },
      create: { key: k, contentType, data: buffer },
      update: { contentType, data: buffer },
    });
    return key;
  }

  async read(key: string): Promise<StoredObject | null> {
    const k = safeKey(key);
    const row = await prisma.storedFile.findUnique({ where: { key: k } });
    if (row) return { data: Buffer.from(row.data), contentType: row.contentType ?? contentTypeFor(k) };
    try {
      const data = await fs.readFile(path.join(LEGACY_STORAGE_DIR, k));
      await this.save(data, k).catch(() => undefined);
      return { data, contentType: contentTypeFor(k) };
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.read(key)) !== null;
  }
}

export const storage: StorageAdapter = new DatabaseStorageAdapter();
