import type { Request } from "express";
import { prisma } from "./prisma";
import { generateId } from "./id";

// The audit trail: who (actor) did what (action) to which record, and when -
// plus, for edits and deletes, the previous and new values. Entries are
// appended to ActivityLog and never changed. See lib/auditEntities.ts for how
// each kind of record is described and middleware/audit.ts for how the REST
// routes are captured automatically.

export interface Links {
  inspectionId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
}

export interface ActivityInput {
  action: string; // e.g. "finding.created"
  entityType: string; // e.g. "Finding"
  entityId?: string | null;
  label?: string | null; // human-readable name of the record
  summary: string; // e.g. "added a finding: Kitchen - moisture damage"
  links?: Links;
  details?: Record<string, unknown> | null;
  clientTime?: Date | null;
}

export function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: (req.headers["user-agent"] ?? "").toString().slice(0, 200) || null };
}

// Best-effort: a failure to write the trail is logged loudly but never turns a
// successful action into an error for the person using the app.
export async function logActivity(req: Request, input: ActivityInput): Promise<void> {
  try {
    const { ip, userAgent } = clientInfo(req);
    const actor = req.user;
    await prisma.activityLog.create({
      data: {
        id: generateId(),
        actorId: actor?.id ?? null,
        actorName: actor?.name || "Unknown",
        actorRole: actor?.role ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.label ? input.label.slice(0, 300) : null,
        summary: input.summary.slice(0, 500),
        inspectionId: input.links?.inspectionId ?? null,
        customerId: input.links?.customerId ?? null,
        propertyId: input.links?.propertyId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        details: (input.details ?? undefined) as any,
        clientTime: input.clientTime ?? null,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("AUDIT WRITE FAILED", input.action, err);
  }
}

// ---- before / after values --------------------------------------------------

const NEVER_COMPARE = new Set(["id", "createdAt", "updatedAt", "deletedAt", "deviceId"]);
const SENSITIVE = /password|hash|secret|token|totp|recovery/i;
const MAX_TEXT = 300;

// Reduces a value to something small and JSON-safe for the trail.
export function plain(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && value !== null && "toJSON" in value && typeof (value as { toJSON: unknown }).toJSON === "function") {
    return plain((value as { toJSON: () => unknown }).toJSON());
  }
  return undefined; // nested objects/arrays are not tracked field-by-field
}

function isTracked(key: string, ignore: string[] | undefined): boolean {
  return !NEVER_COMPARE.has(key) && !SENSITIVE.test(key) && !(ignore ?? []).includes(key);
}

export type Changes = Record<string, { from: unknown; to: unknown }>;

// Fields that differ between two versions of a record (simple fields only).
export function diffRecords(before: Record<string, unknown> | null, after: Record<string, unknown> | null, ignore?: string[]): Changes {
  const out: Changes = {};
  if (!before || !after) return out;
  for (const key of Object.keys(after)) {
    if (!isTracked(key, ignore) || !(key in before)) continue;
    const a = plain(before[key]);
    const b = plain(after[key]);
    if (a === undefined || b === undefined) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out;
}

// A trimmed copy of a record: what was entered (create) or what existed
// (delete).
export function snapshot(record: Record<string, unknown> | null, ignore?: string[]): Record<string, unknown> | null {
  if (!record) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isTracked(key, ignore)) continue;
    const v = plain(value);
    if (v === undefined || v === null) continue;
    out[key] = v;
  }
  return out;
}
