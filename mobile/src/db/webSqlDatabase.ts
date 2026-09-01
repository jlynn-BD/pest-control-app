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

// Call once at app startup on web, before any getDb() call - see App.tsx.
export function initWebSqlDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = initSqlJs({ locateFile: (file: string) => `/${file}` }).then((SQL) => {
      sqlJsDb = new SQL.Database();
    });
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
  },
  runSync(sql, params) {
    requireDb().run(sql, params as (string | number | Uint8Array | null)[] | undefined);
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
    } catch (err) {
      database.run("ROLLBACK");
      throw err;
    }
  },
};
