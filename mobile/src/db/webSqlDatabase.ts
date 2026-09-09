import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import type { LocalDb } from "./database";

// expo-sqlite's web backend needs cross-origin isolation (COOP/COEP) for
// SharedArrayBuffer, and even with that enabled it threw a raw SQLITE_MISUSE
// out of its own worker bridge in this deployment (see git history) - a
// crash serious enough to blank the whole app. sql.js is a plain WASM build
// of SQLite with a synchronous API once loaded and no SharedArrayBuffer/
// cross-origin-isolation requirement at all, so web routes through this
// instead of expo-sqlite. Native (iOS/Android/Expo Go) is unaffected and
// keeps using expo-sqlite normally - see database.ts.
let sqlJsDb: SqlJsDatabase | null = null;
let initPromise: Promise<void> | null = null;

const IDB_NAME = "pestapp-web-sql";
const IDB_STORE = "snapshot";
const IDB_KEY = "db";

function openSnapshotStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSnapshot(): Promise<Uint8Array | null> {
  try {
    const idb = await openSnapshotStore();
    return await new Promise((resolve, reject) => {
      const req = idb.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // No IndexedDB (rare private-browsing edge cases) or first run ever -
    // fall back to starting fresh rather than blocking the app.
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

function saveSnapshotNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!sqlJsDb) return;
  const data = sqlJsDb.export();
  openSnapshotStore()
    .then(
      (idb) =>
        new Promise<void>((resolve, reject) => {
          const tx = idb.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(data, IDB_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    )
    .catch(() => {
      // Best-effort - a failed save just means this session's local
      // writes won't survive a reload, same as before persistence existed.
    });
}

// Debounced rather than saved after every single call - a primeCache or
// sync run can fire dozens of runSync calls back to back (all wrapped in
// one withTransactionSync), and exporting the whole database after each one
// would be wasted work when only the final state after the burst matters.
// Also flushes immediately when the tab is hidden/closed, so an edit made
// right before navigating away isn't lost to the debounce window.
function scheduleSnapshotSave(): void {
  if (!listenersAttached) {
    listenersAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveSnapshotNow();
    });
    window.addEventListener("pagehide", saveSnapshotNow);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSnapshotNow, 500);
}

// Call once at app startup on web, before any getDb() call - see App.tsx.
// Restores the last saved snapshot so a technician's in-progress inspection
// (findings, checklist answers, unsynced photos) survives closing the tab
// or reloading, instead of starting from an empty database every time.
export function initWebSqlDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.all([initSqlJs({ locateFile: (file: string) => `/${file}` }), loadSnapshot()]).then(
      ([SQL, snapshot]) => {
        sqlJsDb = snapshot ? new SQL.Database(snapshot) : new SQL.Database();
      }
    );
  }
  return initPromise;
}

export function isWebSqlReady(): boolean {
  return sqlJsDb !== null;
}

function requireDb(): SqlJsDatabase {
  if (!sqlJsDb) throw new Error("Web SQL database is not initialized yet");
  return sqlJsDb;
}

export const webSqlAdapter: LocalDb = {
  execSync(sql) {
    requireDb().run(sql);
    scheduleSnapshotSave();
  },
  runSync(sql, params) {
    requireDb().run(sql, params as (string | number | Uint8Array | null)[] | undefined);
    scheduleSnapshotSave();
  },
  getFirstSync<T>(sql: string, params?: unknown[]): T | null {
    const stmt = requireDb().prepare(sql, params as (string | number | Uint8Array | null)[] | undefined);
    try {
      return stmt.step() ? (stmt.getAsObject() as unknown as T) : null;
    } finally {
      stmt.free();
    }
  },
  getAllSync<T>(sql: string, params?: unknown[]): T[] {
    const stmt = requireDb().prepare(sql, params as (string | number | Uint8Array | null)[] | undefined);
    const rows: T[] = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
    } finally {
      stmt.free();
    }
    return rows;
  },
  withTransactionSync(fn) {
    const database = requireDb();
    database.run("BEGIN");
    try {
      fn();
      database.run("COMMIT");
      scheduleSnapshotSave();
    } catch (err) {
      database.run("ROLLBACK");
      throw err;
    }
  },
};
