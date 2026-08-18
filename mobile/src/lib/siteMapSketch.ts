import type { SiteMapSketch } from "@pest-app/shared";

const EMPTY: SiteMapSketch = { lines: [], labels: [] };

export function parseSiteMapSketch(json: string | null | undefined): SiteMapSketch {
  if (!json) return EMPTY;
  try {
    const parsed = JSON.parse(json);
    return {
      lines: Array.isArray(parsed?.lines) ? parsed.lines : [],
      labels: Array.isArray(parsed?.labels) ? parsed.labels : [],
    };
  } catch {
    return EMPTY;
  }
}
