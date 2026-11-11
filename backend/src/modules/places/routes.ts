import { Router } from "express";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

// Address lookup, so a property is saved in one standard form ("123 Waterman Dr")
// no matter how it was typed, and next year's search finds the same record.
//
// The app never talks to Google directly: it asks this server, which holds the
// key (GOOGLE_PLACES_API_KEY) and calls Google's Places API (New). With no key
// set, /autocomplete simply returns nothing and the app falls back to typing the
// address in by hand - nothing breaks.
//
// A "session" ties the keystrokes of one lookup to the final pick, which is how
// Google bills autocomplete (one session = one charge, not one per keystroke).

export const placesRouter = Router();
placesRouter.use(requireAuth);

const BASE = (process.env.PLACES_API_BASE || "https://places.googleapis.com").replace(/\/$/, "");
const TIMEOUT_MS = 5000;
const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

const apiKey = () => process.env.GOOGLE_PLACES_API_KEY?.trim() || "";
const regionCodes = () =>
  (process.env.PLACES_REGION_CODES || "us")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c))
    .slice(0, 15);

// A cap per person per minute, so a stuck client can't run up the bill.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 90;
const hits = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  return false;
}

async function google(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, "X-Goog-Api-Key": apiKey() }, signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
  primary: string;
  secondary: string;
}

// GET /api/places/autocomplete?input=14879 war em&session=<uuid>
placesRouter.get(
  "/autocomplete",
  asyncHandler(async (req, res) => {
    if (!apiKey()) return res.json({ enabled: false, suggestions: [] });
    const input = String(req.query.input ?? "").trim().slice(0, 200);
    const session = String(req.query.session ?? "");
    if (input.length < 3) return res.json({ enabled: true, suggestions: [] });
    if (throttled(req.user!.id)) throw new HttpError(429, "Too many address lookups - wait a moment.");

    let result;
    try {
      result = await google("/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          includedRegionCodes: regionCodes(),
          languageCode: "en",
          ...(SESSION_RE.test(session) ? { sessionToken: session } : {}),
        }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Places autocomplete unreachable:", err instanceof Error ? err.message : err);
      return res.json({ enabled: true, unavailable: true, suggestions: [] });
    }
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error("Places autocomplete refused:", result.status, JSON.stringify(result.json?.error ?? result.json).slice(0, 300));
      return res.json({ enabled: true, unavailable: true, suggestions: [] });
    }
    const suggestions: PlaceSuggestion[] = ((result.json?.suggestions as any[]) ?? [])
      .map((s) => s?.placePrediction)
      .filter((p) => p?.placeId)
      .slice(0, 6)
      .map((p) => ({
        placeId: String(p.placeId),
        text: String(p.text?.text ?? ""),
        primary: String(p.structuredFormat?.mainText?.text ?? p.text?.text ?? ""),
        secondary: String(p.structuredFormat?.secondaryText?.text ?? ""),
      }));
    res.json({ enabled: true, suggestions });
  })
);

type Component = { longText?: string; shortText?: string; long_name?: string; short_name?: string; types?: string[] };
const pick = (components: Component[], type: string, short = false): string => {
  const c = components.find((x) => x.types?.includes(type));
  if (!c) return "";
  return ((short ? (c.shortText ?? c.short_name) : (c.longText ?? c.long_name)) ?? "").trim();
};

// GET /api/places/details/:placeId?session=<same uuid> -> the address, split into
// the separate parts the property record stores.
placesRouter.get(
  "/details/:placeId",
  asyncHandler(async (req, res) => {
    if (!apiKey()) throw new HttpError(503, "Address lookup isn't set up.");
    const placeId = req.params.placeId;
    if (!PLACE_ID_RE.test(placeId)) throw new HttpError(400, "That isn't a valid place.");
    const session = String(req.query.session ?? "");
    if (throttled(req.user!.id)) throw new HttpError(429, "Too many address lookups - wait a moment.");

    let result;
    try {
      result = await google(`/v1/places/${encodeURIComponent(placeId)}${SESSION_RE.test(session) ? `?sessionToken=${encodeURIComponent(session)}` : ""}`, {
        method: "GET",
        headers: { "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location" },
      });
    } catch {
      throw new HttpError(502, "Couldn't reach the address lookup. Type the address in instead.");
    }
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error("Places details refused:", result.status, JSON.stringify(result.json?.error ?? result.json).slice(0, 300));
      throw new HttpError(502, "Couldn't look that address up. Type it in instead.");
    }
    const components: Component[] = result.json?.addressComponents ?? [];
    const number = pick(components, "street_number");
    const route = pick(components, "route", true); // "Waterman Dr", matching Google's own formatted address
    const unit = pick(components, "subpremise");
    if (!number || !route) {
      throw new HttpError(422, "That's not a full street address - pick one that starts with a house number, or type the address in.");
    }
    const city = pick(components, "locality") || pick(components, "postal_town") || pick(components, "sublocality_level_1") || pick(components, "administrative_area_level_3");
    const state = pick(components, "administrative_area_level_1", true);
    const postalCode = pick(components, "postal_code");
    if (!city || !state || !postalCode) {
      throw new HttpError(422, "That address is missing its city, state or ZIP. Type the full address in instead.");
    }
    res.json({
      placeId: String(result.json?.id ?? placeId),
      addressLine1: `${number} ${route}${unit ? ` #${unit}` : ""}`,
      city,
      state,
      postalCode,
      country: pick(components, "country", true) || "US",
      lat: typeof result.json?.location?.latitude === "number" ? result.json.location.latitude : null,
      lng: typeof result.json?.location?.longitude === "number" ? result.json.location.longitude : null,
      formatted: String(result.json?.formattedAddress ?? ""),
    });
  })
);
