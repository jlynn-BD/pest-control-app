import { parseRawSketch, visibleSketch } from "@pest-app/shared";

// Describes an edit to a property's site map (one JSON document holding every
// level's walls, labels and shapes) as counts and names: "added 2 walls, a
// label (Garage); removed a shape". Returns null when nothing visible changed.

type Element = { id: string } & Record<string, unknown>;

interface LevelLike {
  id: string;
  name: string;
  lines: Element[];
  labels: Element[];
  annotations: Element[];
}

function compare(before: Element[], after: Element[]) {
  const was = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
  const now = new Map(after.map((e) => [e.id, JSON.stringify(e)]));
  let added = 0;
  let removed = 0;
  let edited = 0;
  const addedItems: Element[] = [];
  for (const e of after) {
    if (!was.has(e.id)) {
      added++;
      addedItems.push(e);
    } else if (was.get(e.id) !== now.get(e.id)) edited++;
  }
  for (const e of before) if (!now.has(e.id)) removed++;
  return { added, removed, edited, addedItems };
}

function levelsOf(json: unknown): LevelLike[] {
  if (typeof json !== "string" || !json) return [];
  return visibleSketch(parseRawSketch(json)).levels as unknown as LevelLike[];
}


export function sketchChange(beforeJson: unknown, afterJson: unknown): { summary: string; details: Record<string, unknown> } | null {
  const before = levelsOf(beforeJson);
  const after = levelsOf(afterJson);
  const parts: string[] = [];
  const perLevel: Record<string, unknown> = {};
  const addedNames: string[] = [];

  const beforeIds = new Set(before.map((l) => l.id));
  for (const level of after) {
    const old = before.find((l) => l.id === level.id);
    if (!beforeIds.has(level.id)) parts.push(`added the "${level.name}" level`);
    const walls = compare(old?.lines ?? [], level.lines);
    const labels = compare(old?.labels ?? [], level.labels);
    const shapes = compare(old?.annotations ?? [], level.annotations);
    const bits: string[] = [];
    const describe = (one: string, many: string, c: ReturnType<typeof compare>) => {
      const n = (count: number) => `${count} ${count === 1 ? one : many}`;
      if (c.added) bits.push(`${n(c.added)} added`);
      if (c.edited) bits.push(`${n(c.edited)} edited`);
      if (c.removed) bits.push(`${n(c.removed)} removed`);
    };
    describe("wall", "walls", walls);
    describe("label", "labels", labels);
    describe("shape/mark", "shapes/marks", shapes);
    for (const e of [...labels.addedItems, ...shapes.addedItems]) {
      const text = (e.text ?? e.label) as unknown;
      if (typeof text === "string" && text) addedNames.push(text);
    }
    if (bits.length) {
      parts.push(`${level.name}: ${bits.join(", ")}`);
      perLevel[level.name] = { walls: stripItems(walls), labels: stripItems(labels), shapes: stripItems(shapes) };
    }
  }
  if (parts.length === 0) return null;
  return {
    summary: `edited the site map (${parts.join("; ")})`,
    details: { levels: perLevel, ...(addedNames.length ? { addedNames: addedNames.slice(0, 20) } : {}) },
  };
}

function stripItems({ added, removed, edited }: { added: number; removed: number; edited: number }) {
  return { added, removed, edited };
}

