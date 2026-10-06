import type { User } from "@pest-app/shared";
import { apiRequest } from "./client";

export type MfaMethod = "SMS" | "TOTP";

// Signing in can take several steps, each answered by the server with the
// next one. "ok" means the person is fully signed in; "challenge" means the
// password was right but something else is still required.
export interface SignedIn {
  status: "ok";
  accessToken: string;
  refreshToken: string;
  user: User;
  // Present only right after setting up two-step sign-in; shown once.
  recoveryCodes?: string[];
}

export interface Challenge {
  status: "challenge";
  challengeToken: string;
  next: "password_change" | "mfa_enroll" | "mfa_verify";
  method: MfaMethod | null;
  maskedPhone: string | null;
  smsAvailable: boolean;
  expiresAt: string;
}

export type LoginResult = SignedIn | Challenge;

export interface TotpEnrollment {
  method: "TOTP";
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface SmsEnrollment {
  method: "SMS";
  maskedPhone: string;
}

const open = { method: "POST" as const, skipAuth: true };

export function login(email: string, password: string): Promise<LoginResult> {
  return apiRequest<LoginResult>("/api/auth/login", { ...open, body: { email, password } });
}

export function changeRequiredPassword(challengeToken: string, newPassword: string): Promise<LoginResult> {
  return apiRequest<LoginResult>("/api/auth/password/change-required", { ...open, body: { challengeToken, newPassword } });
}

export function startEnrollment(challengeToken: string, method: "TOTP"): Promise<TotpEnrollment>;
export function startEnrollment(challengeToken: string, method: "SMS", phone: string): Promise<SmsEnrollment>;
export function startEnrollment(challengeToken: string, method: MfaMethod, phone?: string) {
  return apiRequest<TotpEnrollment | SmsEnrollment>("/api/auth/mfa/enroll/start", { ...open, body: { challengeToken, method, phone } });
}

export function confirmEnrollment(challengeToken: string, code: string): Promise<SignedIn> {
  return apiRequest<SignedIn>("/api/auth/mfa/enroll/confirm", { ...open, body: { challengeToken, code } });
}

export function verifyMfa(challengeToken: string, code: string): Promise<SignedIn> {
  return apiRequest<SignedIn>("/api/auth/mfa/verify", { ...open, body: { challengeToken, code } });
}

export function resendMfaCode(challengeToken: string): Promise<{ ok: true; maskedPhone: string }> {
  return apiRequest("/api/auth/mfa/resend", { ...open, body: { challengeToken } });
}

export function fetchMe(): Promise<User> {
  return apiRequest<User>("/api/auth/me");
}

export function logout(refreshToken: string): Promise<void> {
  return apiRequest<void>("/api/auth/logout", { method: "POST", body: { refreshToken }, skipAuth: true });
}

export function logoutEverywhere(): Promise<void> {
  return apiRequest<void>("/api/auth/logout-all", { method: "POST" });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return apiRequest("/api/auth/password", { method: "POST", body: { currentPassword, newPassword } });
}
