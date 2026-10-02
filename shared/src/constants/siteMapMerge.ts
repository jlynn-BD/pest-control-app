import type { SiteMapAnnotation, SiteMapLevel, SiteMapSketch, SiteMapSketchLabel, SiteMapSketchLine } from "../types";

// Site map sketches are merged element-by-element instead of the whole sketch
// being replaced on every save. Replacing meant two devices editing the same
// property's map - or one device saving a stale copy - silently wiped each
// other's drawings. Every wall/label/shape now carries the time it was last
// changed (updatedAt, ms) and a deleted one is kept as a small tombstone
// ({ id, deleted: true, updatedAt }) so a delete can't be undone by a device
// that still has the old copy. Merging two sketches keeps, per element id,
// whichever version changed most recently (a delete wins a tie).

export interface Stamp {
  updatedAt?: number;
  deleted?: boolean;
}
export type RawLine = Partial<SiteMapSketchLine> & { id: string } & Stamp;
export type RawLabel = Partial<SiteMapSketchLabel> & { id: string } & Stamp;
export type RawAnnotation = Partial<SiteMapAnnotation> & { id: string } & Stamp;
export interface RawLevel {
  id: string;
  name: string;
  sortOrder: number;
  lines: RawLine[];
  labels: RawLabel[];
  annotations: RawAnnotation[];
}
export interface RawSketch {
  levels: RawLevel[];
}

const EMPTY_RAW: RawSketch = { levels: [] };

// Tolerant parse of a stored sketch, keeping tombstones/timestamps. Elements
// saved before ids existed get the same stable synthetic ids the display
// layer always used, so they can be edited/deleted/merged like any other.
export function parseRawSketch(json: string | null | undefined): RawSketch {
  if (!json) return EMPTY_RAW;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed?.levels)) return EMPTY_RAW;
    const levels: RawLevel[] = [];
    for (const l of parsed.levels) {
      if (typeof l !== "object" || l === null || typeof l.id !== "string" || typeof l.name !== "string") continue;
      levels.push({
        id: l.id,
        name: l.name,
        sortOrder: typeof l.sortOrder === "number" ? l.sortOrder : 0,
        lines: Array.isArray(l.lines) ? l.lines.map((x: RawLine, i: number) => ({ ...x, id: x.id ?? `${l.id}:line:${i}` })) : [],
        labels: Array.isArray(l.labels) ? l.labels.map((x: RawLabel, i: number) => ({ ...x, id: x.id ?? `${l.id}:label:${i}` })) : [],
        annotations: Array.isArray(l.annotations) ? l.annotations : [],
      });
    }
    return { levels };
  } catch {
    return EMPTY_RAW;
  }
}

function live<T extends Stamp>(items: T[]): T[] {
  return items.filter((i) => !i.deleted);
}

// What the app draws: tombstones removed, timestamps left on (harmless).
export function visibleSketch(raw: RawSketch): SiteMapSketch {
  return {
    levels: raw.levels.map(
      (l): SiteMapLevel => ({
        id: l.id,
        name: l.name,
        sortOrder: l.sortOrder,
        lines: live(l.lines) as SiteMapSketchLine[],
        labels: live(l.labels) as SiteMapSketchLabel[],
        annotations: live(l.annotations) as SiteMapAnnotation[],
      })
    ),
  };
}

// Key order must not matter - a re-ordered but identical element would
// otherwise look edited and be re-stamped newer than another device's change.
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
function sameContent(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function mergeElements<T extends { id: string } & Stamp>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const el of a) byId.set(el.id, el);
  for (const el of b) {
    const cur = byId.get(el.id);
    if (!cur) {
      byId.set(el.id, el);
      continue;
    }
    const ta = cur.updatedAt ?? 0;
    const tb = el.updatedAt ?? 0;
    if (tb > ta) byId.set(el.id, el);
    else if (tb === ta && el.deleted && !cur.deleted) byId.set(el.id, el);
  }
  return [...byId.values()];
}

export function mergeSketches(a: RawSketch, b: RawSketch): RawSketch {
  const byId = new Map<string, RawLevel>();
  for (const l of a.levels) byId.set(l.id, l);
  for (const l of b.levels) {
    const cur = byId.get(l.id);
    if (!cur) {
      byId.set(l.id, l);
      continue;
    }
    byId.set(l.id, {
      id: cur.id,
      name: cur.name,
      sortOrder: cur.sortOrder,
      lines: mergeElements(cur.lines, l.lines),
      labels: mergeElements(cur.labels, l.labels),
      annotations: mergeElements(cur.annotations, l.annotations),
    });
  }
  return { levels: [...byId.values()] };
}

function diffElements<T extends { id: string } & Stamp>(oldRaw: T[], nextVisible: T[], now: number): T[] {
  const out: T[] = [];
  const oldById = new Map(oldRaw.map((e) => [e.id, e]));
  const nextIds = new Set(nextVisible.map((e) => e.id));
  for (const e of nextVisible) {
    const prev = oldById.get(e.id);
    const { updatedAt: _u, deleted: _d, ...bare } = e as T & Stamp;
    const { updatedAt: _pu, deleted: _pd, ...prevBare } = (prev ?? {}) as T & Stamp;
    out.push(prev && !prev.deleted && sameContent(bare, prevBare) ? prev : ({ ...bare, updatedAt: now } as unknown as T));
  }
  for (const prev of oldRaw) {
    if (nextIds.has(prev.id)) continue;
    out.push(prev.deleted ? prev : ({ id: prev.id, deleted: true, updatedAt: now } as unknown as T));
  }
  return out;
}

// Turns "the level the technician just edited" (as the UI sees it, with
// deletions simply missing) into the stored form: changed elements get a new
// timestamp, removed ones become tombstones, untouched ones are left exactly
// as they were.
export function applyLevelEdit(oldRaw: RawLevel, nextVisible: SiteMapLevel, now: number): RawLevel {
  return {
    id: oldRaw.id,
    name: nextVisible.name,
    sortOrder: nextVisible.sortOrder,
    lines: diffElements(oldRaw.lines, nextVisible.lines as RawLine[], now),
    labels: diffElements(oldRaw.labels, nextVisible.labels as RawLabel[], now),
    annotations: diffElements(oldRaw.annotations, nextVisible.annotations as RawAnnotation[], now),
  };
}
