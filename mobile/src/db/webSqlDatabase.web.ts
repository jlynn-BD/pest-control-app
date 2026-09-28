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

// A read error is thrown (not turned into "no data") so the caller can tell
// "nothing saved yet" apart from "couldn't read what's saved".
async function loadSnapshotUnbounded(): Promise<Uint8Array | null> {
  const idb = await openSnapshotStore();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

// IndexedDB can be slow to answer (slow first-open, disk contention, ...)
// with no error - just silence. Since this gates the whole app's startup
// screen (see App.tsx), a stuck IndexedDB must not mean a stuck app, so the
// wait has a budget. But NEVER treat "didn't answer in time" as "there is no
// saved data": starting blank and then saving would overwrite the technician's
// stored, possibly not-yet-synced inspections with an empty database. If the
// load fails or times out, the app runs for this session without saving
// (persistenceDisabled) and the stored snapshot is left untouched.
const LOAD_BUDGET_MS = 10000;
let persistenceDisabled = false;

function loadSnapshot(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Uint8Array | null, ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) persistenceDisabled = true;
      resolve(value);
    };
    setTimeout(() => finish(null, false), LOAD_BUDGET_MS);
    loadSnapshotUnbounded()
      .then((data) => finish(data, true))
      .catch(() => finish(null, false));
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

function saveSnapshotNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!sqlJsDb || persistenceDisabled) return;
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
        // Ask the browser not to evict this database when storage is tight
        // (Safari in particular clears site data it considers idle) - it
        // holds inspections that may not have synced yet.
        try {
          navigator.storage?.persist?.().catch(() => undefined);
        } catch {
          // not supported - nothing to do
        }
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
