import type { User } from "@pest-app/shared";
import { apiRequest } from "./client";

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/auth/login", { method: "POST", body: { email, password }, skipAuth: true });
}

export function fetchMe(): Promise<User> {
  return apiRequest<User>("/api/auth/me");
}

export function logout(refreshToken: string): Promise<void> {
  return apiRequest<void>("/api/auth/logout", { method: "POST", body: { refreshToken }, skipAuth: true });
}
