import { File, Paths } from "expo-file-system";
import { getDb, isLocalDbAvailable } from "./database";
import { apiRequest } from "../api/client";
import { API_BASE_URL } from "../api/config";
import { tokenStore } from "../api/tokenStore";
import type { LocalCustomer, LocalPestType, LocalProperty, LocalTemplate, LocalTemplateItem, LocalTemplateSection } from "./types";

interface RemoteCustomer {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  properties: RemoteProperty[];
}
interface RemoteProperty {
  id: string;
  customerId: string;
  label: string | null;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  propertyType: string;
  accessNotes: string | null;
  siteMapImageUrl: string | null;
  siteMapSketch: string | null;
  siteMapUpdatedAt: string | null;
}
interface RemoteTemplate {
  id: string;
  name: string;
  description: string | null;
  sections: Array<{
    id: string;
    templateId: string;
    name: string;
    category: string;
    sortOrder: number;
    items: Array<{ id: string; sectionId: string; prompt: string; itemType: string; sortOrder: number; required: boolean }>;
  }>;
}
interface RemotePestType {
  id: string;
  name: string;
  category: string | null;
}

// Downloads a property's site map image into a stable local cache path so
// the drawing screen still has something to render offline. Best-effort:
// a failed download just leaves the property without a local copy, and the
// screen falls back to loading the remote URL directly (fine when online,
// degrades gracefully otherwise) rather than blocking the whole cache prime.
async function cacheSiteMapImage(propertyId: string, remoteUrl: string): Promise<string | null> {
  try {
    const token = await tokenStore.getAccessToken();
    const ext = remoteUrl.split(".").pop()?.split("?")[0] || "jpg";
    const destination = new File(Paths.document, `site-map-${propertyId}.${ext}`);
    const file = await File.downloadFileAsync(`${API_BASE_URL}${remoteUrl}`, destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    });
    return file.uri;
  } catch {
    return null;
  }
}

// Pulls reference data (customers/properties/templates/pest types) down to
// local SQLite so a technician can start and complete an inspection with
// zero connectivity, as long as this has run at least once while online.
export async function primeCache(): Promise<void> {
  if (!isLocalDbAvailable()) return;
  const db = getDb();

  const [customers, templates, pestTypes] = await Promise.all([
    apiRequest<RemoteCustomer[]>("/api/customers"),
    apiRequest<RemoteTemplate[]>("/api/templates"),
    apiRequest<RemotePestType[]>("/api/pest-types"),
  ]);

  // Downloads happen outside the sync transaction below (SQLite transactions
  // here are synchronous). Only re-download when the remote URL actually
  // changed since the last prime, so re-uploading the same site map doesn't
  // re-fetch it on every sync.
  const siteMapLocalUris = new Map<string, string>();
  const properties = customers.flatMap((c) => c.properties);
  await Promise.all(
    properties
      .filter((p) => p.siteMapImageUrl)
      .map(async (p) => {
        const existing = db.getFirstSync<{ siteMapImageUrl: string | null; siteMapLocalUri: string | null }>(
          `SELECT siteMapImageUrl, siteMapLocalUri FROM local_properties WHERE id = ?`,
          [p.id]
        );
        if (existing?.siteMapImageUrl === p.siteMapImageUrl && existing.siteMapLocalUri) {
          siteMapLocalUris.set(p.id, existing.siteMapLocalUri);
          return;
        }
        const localUri = await cacheSiteMapImage(p.id, p.siteMapImageUrl!);
        if (localUri) siteMapLocalUris.set(p.id, localUri);
      })
  );

  db.withTransactionSync(() => {
    for (const c of customers) {
      db.runSync(
        `INSERT OR REPLACE INTO local_customers (id, name, type, phone, email, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.type, c.phone, c.email, c.city, c.state]
      );
      for (const p of c.properties) {
        db.runSync(
          `INSERT OR REPLACE INTO local_properties (id, customerId, label, addressLine1, city, state, postalCode, propertyType, accessNotes, siteMapImageUrl, siteMapLocalUri, siteMapSketchJson, siteMapUpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.customerId,
            p.label,
            p.addressLine1,
            p.city,
            p.state,
            p.postalCode,
            p.propertyType,
            p.accessNotes,
            p.siteMapImageUrl,
            siteMapLocalUris.get(p.id) ?? null,
            p.siteMapSketch,
            p.siteMapUpdatedAt,
          ]
        );
      }
    }

    for (const t of templates) {
      db.runSync(`INSERT OR REPLACE INTO local_templates (id, name, description) VALUES (?, ?, ?)`, [t.id, t.name, t.description]);
      for (const s of t.sections) {
        db.runSync(
          `INSERT OR REPLACE INTO local_template_sections (id, templateId, name, category, sortOrder) VALUES (?, ?, ?, ?, ?)`,
          [s.id, s.templateId, s.name, s.category, s.sortOrder]
        );
        for (const i of s.items) {
          db.runSync(
            `INSERT OR REPLACE INTO local_template_items (id, sectionId, prompt, itemType, sortOrder, required) VALUES (?, ?, ?, ?, ?, ?)`,
            [i.id, s.id, i.prompt, i.itemType, i.sortOrder, i.required ? 1 : 0]
          );
        }
      }
    }

    for (const pt of pestTypes) {
      db.runSync(`INSERT OR REPLACE INTO local_pest_types (id, name, category) VALUES (?, ?, ?)`, [pt.id, pt.name, pt.category]);
    }
  });
}

// Optimistic local update after a successful save, so the sketch reflects
// immediately without waiting for the next primeCache round-trip.
export function updateLocalPropertySiteMapSketch(propertyId: string, sketchJson: string): void {
  if (!isLocalDbAvailable()) return;
  getDb().runSync(`UPDATE local_properties SET siteMapSketchJson = ? WHERE id = ?`, [sketchJson, propertyId]);
}

export function getCachedCustomers(): LocalCustomer[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalCustomer>(`SELECT * FROM local_customers ORDER BY name ASC`);
}

export function getCachedProperties(customerId?: string): LocalProperty[] {
  if (!isLocalDbAvailable()) return [];
  if (customerId) {
    return getDb().getAllSync<LocalProperty>(`SELECT * FROM local_properties WHERE customerId = ?`, [customerId]);
  }
  return getDb().getAllSync<LocalProperty>(`SELECT * FROM local_properties`);
}

export function getCachedProperty(id: string): LocalProperty | null {
  if (!isLocalDbAvailable()) return null;
  return getDb().getFirstSync<LocalProperty>(`SELECT * FROM local_properties WHERE id = ?`, [id]);
}

export function getCachedCustomer(id: string): LocalCustomer | null {
  if (!isLocalDbAvailable()) return null;
  return getDb().getFirstSync<LocalCustomer>(`SELECT * FROM local_customers WHERE id = ?`, [id]);
}

export function getCachedTemplates(): LocalTemplate[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalTemplate>(`SELECT * FROM local_templates ORDER BY name ASC`);
}

export function getCachedTemplateSections(templateId: string): (LocalTemplateSection & { items: LocalTemplateItem[] })[] {
  if (!isLocalDbAvailable()) return [];
  const db = getDb();
  const sections = db.getAllSync<LocalTemplateSection>(
    `SELECT * FROM local_template_sections WHERE templateId = ? ORDER BY sortOrder ASC`,
    [templateId]
  );
  return sections.map((s) => ({
    ...s,
    items: db.getAllSync<LocalTemplateItem>(`SELECT * FROM local_template_items WHERE sectionId = ? ORDER BY sortOrder ASC`, [s.id]),
  }));
}

export function getCachedPestTypes(): LocalPestType[] {
  if (!isLocalDbAvailable()) return [];
  return getDb().getAllSync<LocalPestType>(`SELECT * FROM local_pest_types ORDER BY name ASC`);
}
