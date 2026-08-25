import * as SQLite from "expo-sqlite";

let db: SQLite.SQLiteDatabase | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS local_customers (
  id TEXT PRIMARY KEY, name TEXT, type TEXT, phone TEXT, email TEXT, city TEXT, state TEXT
);
CREATE TABLE IF NOT EXISTS local_properties (
  id TEXT PRIMARY KEY, customerId TEXT, label TEXT, addressLine1 TEXT, city TEXT, state TEXT,
  postalCode TEXT, propertyType TEXT, accessNotes TEXT,
  siteMapImageUrl TEXT, siteMapLocalUri TEXT, siteMapSketchJson TEXT, siteMapUpdatedAt TEXT
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
CREATE TABLE IF NOT EXISTS local_pest_types (
  id TEXT PRIMARY KEY, name TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY, propertyId TEXT, customerId TEXT, templateId TEXT, technicianId TEXT,
  status TEXT, scheduledAt TEXT, startedAt TEXT, completedAt TEXT, generalNotes TEXT, weatherConditions TEXT,
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, inspectionId TEXT, pestTypeId TEXT, pestTypeOther TEXT, areaLocation TEXT,
  locationDetail TEXT, evidenceTypes TEXT, severity TEXT, riskFactors TEXT, entryPoints TEXT,
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
CREATE TABLE IF NOT EXISTS treatment_records (
  id TEXT PRIMARY KEY, inspectionId TEXT, findingId TEXT, technicianId TEXT, method TEXT, targetPest TEXT,
  areaTreated TEXT, appliedAt TEXT, safetyInstructions TEXT, notes TEXT, approvalStatus TEXT DEFAULT 'PENDING',
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS treatment_products (
  id TEXT PRIMARY KEY, treatmentRecordId TEXT, productName TEXT, epaRegistrationNumber TEXT,
  activeIngredient TEXT, quantity REAL, unit TEXT, concentration TEXT, applicationMethod TEXT
);
CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY, inspectionId TEXT, signerType TEXT, signerName TEXT, imageBase64 TEXT,
  remoteUrl TEXT, signedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS checklist_responses (
  id TEXT PRIMARY KEY, inspectionId TEXT, templateItemId TEXT, status TEXT, notes TEXT,
  createdAt TEXT, updatedAt TEXT, syncStatus TEXT DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, value TEXT
);
`;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync("pestapp.db");
    db.execSync(SCHEMA_SQL);
  }
  return db;
}

// expo-sqlite's web backend runs its synchronous API in a Worker
// synchronized via SharedArrayBuffer, which browsers only expose on
// cross-origin-isolated pages (COOP/COEP response headers). Expo's plain
// `expo start --web` dev server doesn't set those, so openDatabaseSync
// reliably throws there - screens must degrade gracefully when this
// returns false. Native (Expo Go / a device build) has no such
// restriction; this is a web-only limitation.
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
