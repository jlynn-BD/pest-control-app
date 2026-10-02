import { mergeSketches, parseRawSketch, RawSketch } from "@pest-app/shared";
import { saveSiteMapSketch } from "../api/properties";
import { getCachedProperty, listDirtySiteMapSketchIds, setSiteMapSketchDirty, updateLocalPropertySiteMapSketch } from "../db/cache";

// Site map edits are saved on the device first and pushed to the server in
// the background (and on every sync), so drawing works with no signal and a
// failed request never loses or blocks a drawing. The server merges per
// wall/label/shape (newest change wins, deletes are remembered), so two
// technicians - or one technician on a stale copy - can't wipe out each
// other's work. See shared/constants/siteMapMerge.ts.

export function saveSketchLocally(propertyId: string, sketch: RawSketch): void {
  updateLocalPropertySiteMapSketch(propertyId, JSON.stringify(sketch));
  setSiteMapSketchDirty(propertyId, true);
}

let inFlight: Promise<number> | null = null;
let rerun = false;

// Pushes every property whose map has unsent edits. One run at a time; an
// edit made while a push is in flight triggers another pass right after, so
// the latest version always gets sent. Returns how many maps were confirmed.
export function pushDirtySketches(): Promise<number> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    let confirmed = 0;
    try {
      do {
        rerun = false;
        for (const propertyId of listDirtySiteMapSketchIds()) {
          const pushedJson = getCachedProperty(propertyId)?.siteMapSketchJson;
          if (!pushedJson) {
            setSiteMapSketchDirty(propertyId, false);
            continue;
          }
          try {
            const saved = await saveSiteMapSketch(propertyId, parseRawSketch(pushedJson));
            const nowLocalJson = getCachedProperty(propertyId)?.siteMapSketchJson ?? pushedJson;
            // Take in whatever other devices added, without losing edits
            // made here while the request was in flight.
            const merged = mergeSketches(parseRawSketch(nowLocalJson), parseRawSketch(saved.siteMapSketch));
            updateLocalPropertySiteMapSketch(propertyId, JSON.stringify(merged));
            if (nowLocalJson === pushedJson) setSiteMapSketchDirty(propertyId, false);
            else rerun = true;
            confirmed += 1;
          } catch {
            // Offline or server trouble: stays pending, retried on the next sync.
          }
        }
      } while (rerun);
    } finally {
      inFlight = null;
    }
    return confirmed;
  })();
  return inFlight;
}
