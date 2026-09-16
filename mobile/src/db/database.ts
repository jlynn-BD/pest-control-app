import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { isWebSqlReady, webSqlAdapter } from "./webSqlDatabase";

// The small subset of expo-sqlite's SQLiteDatabase API this app actually
// uses - lets web substitute a completely different backend (sql.js, see
// webSqlDatabase.ts) without every call site caring which one is live.
export interface LocalDb {
  execSync(sql: string): void;
  runSync(sql: string, params?: unknown[]): void;
  getFirstSync<T>(sql: string, params?: unknown[]): T | null;
  getAllSync<T>(sql: string, params?: unknown[]): T[];
  withTransactionSync(fn: () => void): void;
}

let db: LocalDb | null = null;

// `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already
// exists with an older column set - and on web, the sql.js database
// persists across sessions via an IndexedDB snapshot (see
// webSqlDatabase.ts), so a browser that used this app before these
// columns existed has a local_properties table without them. Each ADD
// COLUMN is wrapped since "already exists" is the expected outcome on
// every subsequent boot, not an error.
const LOCAL_PROPERTIES_MIGRATION_COLUMNS = ["hasSecondFloor", "hasThirdFloor", "hasBasement", "hasCrawlspace"];
function migrateLocalProperties(adapter: LocalDb): void {
  for (const column of LOCAL_PROPERTIES_MIGRATION_COLUMNS) {
    try {
      adapter.execSync(`ALTER TABLE local_properties ADD COLUMN ${column} INTEGER`);
    } catch {
      // Column already exists - expected on every boot after the first.
    }
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS local_customers (
  id TEXT PRIMARY KEY, name TEXT, type TEXT, phone TEXT, email TEXT, city TEXT, state TEXT
);
CREATE TABLE IF NOT EXISTS local_properties (
  id TEXT PRIMARY KEY, customerId TEXT, label TEXT, addressLine1 TEXT, city TEXT, state TEXT,
  postalCode TEXT, propertyType TEXT, accessNotes TEXT,
  siteMapImageUrl TEXT, siteMapLocalUri TEXT, siteMapSketchJson TEXT, siteMapUpdatedAt TEXT,
  hasSecondFloor INTEGER, hasThirdFloor INTEGER, hasBasement INTEGER, hasCrawlspace INTEGER
);
CREATE TABLE IF NOT EXISTS local_templates (
  id TEXT PRIMARY KEY, name TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS local_template_sections (
  id TEXT PRIMARY KEY, templateId TEXT, name TEXT, category TEXT DEFAULT 'OTHER', sortOrder INTEGER
);
CREATE TABLE IF NOT EXISTS local_template_items (
  id TEXT PRIMARY KEY, sectionId TEXT, prompt TEXT, itemType TEXT, sortOrder INTEGER, required INTEGER
);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY, propertyId TEXT, customerId TEXT, templateId TEXT, technicianId TEXT,
  status TEXT, scheduledAt TEXT, startedAt TEXT, completedAt TEXT, generalNotes TEXT, weatherConditions TEXT,
  checklistCategories TEXT,
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
-- Evidence/entry points/risk factors and pest type are no longer separate
-- structured fields (Matt's ask - see FINDING_NOTES_GUIDANCE in shared) so
-- new local DBs don't get those columns; an existing local DB from before
-- this change simply carries them along unused, same one-directional
-- pattern as every other column change here (only ever ADD, never DROP).
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, inspectionId TEXT, areaLocation TEXT,
  locationDetail TEXT, severity TEXT,
  description TEXT, lat REAL, lng REAL,
  floorPlanX REAL, floorPlanY REAL, siteMapArrowStartX REAL, siteMapArrowStartY REAL, siteMapLevel TEXT,
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS finding_photos (
  id TEXT PRIMARY KEY, findingId TEXT, localUri TEXT, remoteUrl TEXT, caption TEXT, takenAt TEXT,
  lat REAL, lng REAL, sortOrder INTEGER, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY, inspectionId TEXT, findingId TEXT, title TEXT, description TEXT, priority TEXT,
  ownerType TEXT, deadline TEXT, status TEXT DEFAULT 'OPEN', createdAt TEXT, updatedAt TEXT,
  syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY, inspectionId TEXT, signerType TEXT, signerName TEXT, imageBase64 TEXT,
  remoteUrl TEXT, signedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS checklist_responses (
  id TEXT PRIMARY KEY, inspectionId TEXT, templateItemId TEXT, status TEXT, notes TEXT,
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS checklist_response_photos (
  id TEXT PRIMARY KEY, checklistResponseId TEXT, localUri TEXT, remoteUrl TEXT, caption TEXT, takenAt TEXT,
  sortOrder INTEGER, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS inspection_section_skips (
  id TEXT PRIMARY KEY, inspectionId TEXT, category TEXT, technicianId TEXT, initials TEXT,
  confirmedAt TEXT, createdAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, value TEXT
);
`;

export function getDb(): LocalDb {
  if (!db) {
    if (Platform.OS === "web") {
      // Throws until initWebSqlDatabase() (called once at app startup on
      // web, see App.tsx) has finished loading the sql.js WASM module.
      if (!isWebSqlReady()) throw new Error("Web SQL database is not initialized yet");
      db = webSqlAdapter;
      db.execSync(SCHEMA_SQL);
      migrateLocalProperties(db);
    } else {
      const native = SQLite.openDatabaseSync("pestapp.db");
      // Wrapped rather than assigned directly - expo-sqlite's runSync/
      // getFirstSync/getAllSync are overloaded with a variadic form that
      // doesn't structurally match LocalDb's simpler (sql, params?) shape.
      const adapter: LocalDb = {
        execSync: (sql) => native.execSync(sql),
        runSync: (sql, params) => void native.runSync(sql, (params ?? []) as SQLite.SQLiteBindParams),
        getFirstSync: <T,>(sql: string, params?: unknown[]) => native.getFirstSync<T>(sql, (params ?? []) as SQLite.SQLiteBindParams),
        getAllSync: <T,>(sql: string, params?: unknown[]) => native.getAllSync<T>(sql, (params ?? []) as SQLite.SQLiteBindParams),
        withTransactionSync: (fn) => native.withTransactionSync(fn),
      };
      adapter.execSync(SCHEMA_SQL);
      migrateLocalProperties(adapter);
      db = adapter;
    }
  }
  return db;
}

export function isLocalDbAvailable(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

export function getSyncMeta(key: string): string | null {
  if (!isLocalDbAvailable()) return null;
  const row = getDb().getFirstSync<{ value: string }>(`SELECT value FROM sync_meta WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export function setSyncMeta(key: string, value: string): void {
  getDb().runSync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [key, value]);
}
