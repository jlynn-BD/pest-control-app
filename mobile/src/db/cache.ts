import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { getDb, isLocalDbAvailable } from "./database";
import { apiRequest } from "../api/client";
import { API_BASE_URL } from "../api/config";
import { tokenStore } from "../api/tokenStore";
import type { LocalCustomer, LocalProperty, LocalTemplate, LocalTemplateItem, LocalTemplateSection } from "./types";

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
  hasSecondFloor: boolean | null;
  hasThirdFloor: boolean | null;
  hasBasement: boolean | null;
  hasCrawlspace: boolean | null;
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

// Pulls reference data (customers/properties/templates) down to local
// storage so a technician can start and complete an inspection with zero
// connectivity, as long as this has run at least once while online.
export async function primeCache(): Promise<void> {
  if (!isLocalDbAvailable()) return;
  const db = getDb();

  const [customers, templates] = await Promise.all([
    apiRequest<RemoteCustomer[]>("/api/customers"),
    apiRequest<RemoteTemplate[]>("/api/templates"),
  ]);

  // Downloads happen outside the sync transaction below (SQLite transactions
  // here are synchronous). Only re-download when the remote URL actually
  // changed since the last prime, so re-uploading the same site map doesn't
  // re-fetch it on every sync. Native only - expo-file-system's downloader
  // is unsupported on web (see cacheSiteMapImage), so screens there fall
  // back to loading the remote URL directly.
  const siteMapLocalUris = new Map<string, string>();
  const properties = customers.flatMap((c) => c.properties);
  if (Platform.OS !== "web") {
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
  }

  db.withTransactionSync(() => {
    for (const c of customers) {
      db.runSync(
        `INSERT OR REPLACE INTO local_customers (id, name, type, phone, email, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.type, c.phone, c.email, c.city, c.state]
      );
      for (const p of c.properties) {
        db.runSync(
          `INSERT OR REPLACE INTO local_properties (id, customerId, label, addressLine1, city, state, postalCode, propertyType, accessNotes, siteMapImageUrl, siteMapLocalUri, siteMapSketchJson, siteMapUpdatedAt, hasSecondFloor, hasThirdFloor, hasBasement, hasCrawlspace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            p.hasSecondFloor == null ? null : p.hasSecondFloor ? 1 : 0,
            p.hasThirdFloor == null ? null : p.hasThirdFloor ? 1 : 0,
            p.hasBasement == null ? null : p.hasBasement ? 1 : 0,
            p.hasCrawlspace == null ? null : p.hasCrawlspace ? 1 : 0,
          ]
        );
      }
    }

    // Full replace, not incremental: templates are pure server-mirrored
    // reference data (no local-only fields to preserve, unlike properties'
    // siteMapLocalUri above), so wiping and rebuilding from this fetch is
    // safe and necessary - INSERT OR REPLACE alone only ever adds/updates
    // rows present in the current response, it never removes a section or
    // item that was renamed/retired server-side (e.g. this session's
    // checklist restructuring work), which is exactly how stale duplicates
    // like "Exterior Perimeter" alongside the current "Exterior structure"
    // were able to linger forever in a device's local cache.
    db.runSync(`DELETE FROM local_template_items`);
    db.runSync(`DELETE FROM local_template_sections`);
    db.runSync(`DELETE FROM local_templates`);
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
  });
}

// Optimistic local update after a successful save, so the sketch reflects
// immediately without waiting for the next primeCache round-trip.
export function updateLocalPropertySiteMapSketch(propertyId: string, sketchJson: string): void {
  if (!isLocalDbAvailable()) return;
  getDb().runSync(`UPDATE local_properties SET siteMapSketchJson = ? WHERE id = ?`, [sketchJson, propertyId]);
}

// Same optimistic-update pattern as updateLocalPropertySiteMapSketch, for
// the checklist wizard's "this property doesn't have this" answers -
// written immediately so the wizard isn't blocked on the paired best-effort
// PATCH (see api/properties.ts's patchPropertyApplicability) landing first.
export function updateLocalPropertyApplicability(
  propertyId: string,
  patch: Partial<Pick<LocalProperty, "hasSecondFloor" | "hasThirdFloor" | "hasBasement" | "hasCrawlspace">>
): void {
  if (!isLocalDbAvailable()) return;
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  const db = getDb();
  db.runSync(
    `UPDATE local_properties SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...columns.map((c) => patch[c as keyof typeof patch]), propertyId]
  );
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

