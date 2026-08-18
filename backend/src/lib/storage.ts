import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_DIR = path.resolve(process.cwd(), process.env.STORAGE_DIR || "./storage");

export interface StorageAdapter {
  save(buffer: Buffer, key: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  getAbsolutePath(key: string): string;
}

// Local filesystem implementation. Swappable for an S3-compatible adapter
// later without touching callers (media/reports modules only depend on
// the StorageAdapter interface).
class LocalStorageAdapter implements StorageAdapter {
  async save(buffer: Buffer, key: string): Promise<string> {
    const absPath = this.getAbsolutePath(key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.getAbsolutePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.getAbsolutePath(key));
      return true;
    } catch {
      return false;
    }
  }

  getAbsolutePath(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
    return path.join(STORAGE_DIR, normalized);
  }
}

export const storage: StorageAdapter = new LocalStorageAdapter();
