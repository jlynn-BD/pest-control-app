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
    if (res.status >= 500) return "unreachable";
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

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

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
