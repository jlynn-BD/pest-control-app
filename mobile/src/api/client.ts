import { API_BASE_URL } from "./config";
import { tokenStore } from "./tokenStore";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

let refreshPromise: Promise<"ok" | "rejected" | "unreachable"> | null = null;

// "rejected" means the server said the refresh token is no good (log the
// user out); "unreachable" means there was no connection, which says nothing
// about the session - a technician with no signal must stay logged in.
async function refreshTokens(): Promise<"ok" | "rejected" | "unreachable"> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return "rejected";
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    // 409 = the server just rotated this token and a retry is in flight
    // (e.g. the earlier response was lost on a bad connection): not a "no".
    if (res.status >= 500 || res.status === 409) return "unreachable";
    if (!res.ok) return "rejected";
    const data = await res.json();
    await tokenStore.setTokens(data.accessToken, data.refreshToken);
    return "ok";
  } catch {
    return "unreachable";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  isFormData?: boolean;
  skipAuth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = "GET", body, isFormData, skipAuth } = options;
  const headers: Record<string, string> = {};

  if (!skipAuth) {
    const token = await tokenStore.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body && !isFormData) headers["Content-Type"] = "application/json";

  // The server sleeps when idle and restarts when a new version goes live; for
  // a short while requests then fail outright (the browser just says "Failed to
  // fetch"). Sign-in requests and reads are safe to repeat, so they are tried
  // again a couple of times, and anything that still fails says so plainly.
  const safeToRepeat = Boolean(skipAuth) || method === "GET";
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Truly offline (the device says so): fail at once rather than keep a screen waiting.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (!safeToRepeat || offline || attempt === 2) throw new ApiError(0, "Can't reach the server right now. Check your connection, wait a moment and try again.");
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  if (!res) throw new ApiError(0, "Can't reach the server right now. Check your connection, wait a moment and try again.");

  if (res.status === 401 && !skipAuth && !isRetry) {
    if (!refreshPromise) refreshPromise = refreshTokens().finally(() => (refreshPromise = null));
    const refreshed = await refreshPromise;
    if (refreshed === "ok") return apiRequest<T>(path, options, true);
    if (refreshed === "unreachable") throw new ApiError(0, "Unable to reach the server");
    await tokenStore.clear();
    onSessionExpired?.();
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
