import Constants from "expo-constants";

// Derive the API base URL from the Metro dev server host so this works
// both in `expo start --web` (localhost) and in Expo Go on a physical
// device (LAN IP), with no manual config needed for local dev.
function resolveApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:4000`;
  }
  return "http://localhost:4000";
}

export const API_BASE_URL = resolveApiBaseUrl();
