import { apiRequest } from "./client";

// Address lookup (see backend modules/places). The server holds the Google key;
// with no key set it answers "enabled: false" and the app just lets the person
// type the address in.

export interface PlaceSuggestion {
  placeId: string;
  text: string;
  primary: string;
  secondary: string;
}

export interface ResolvedPlace {
  placeId: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  lat: number | null;
  lng: number | null;
  formatted: string;
}

export function searchPlaces(input: string, session: string): Promise<{ enabled: boolean; unavailable?: boolean; suggestions: PlaceSuggestion[] }> {
  return apiRequest(`/api/places/autocomplete?input=${encodeURIComponent(input)}&session=${encodeURIComponent(session)}`);
}

export function getPlaceDetails(placeId: string, session: string): Promise<ResolvedPlace> {
  return apiRequest(`/api/places/details/${encodeURIComponent(placeId)}?session=${encodeURIComponent(session)}`);
}
