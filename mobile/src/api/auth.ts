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
  next: "password_change" | "mfa_enroll" | "mfa_verify" | "otp_verify";
  method: MfaMethod | "EMAIL" | null;
  maskedPhone: string | null;
  // Set when the sign-in code was emailed rather than texted.
  maskedEmail?: string | null;
  smsAvailable: boolean;
  expiresAt: string;
}

export type LoginResult = SignedIn | Challenge;

// First step of "email -> text code": a code was texted (challenge), or this
// account can't use texts and needs its password.
export type OtpRequestResult = Challenge | { status: "password_required" };

export function requestTextCode(email: string): Promise<OtpRequestResult> {
  return apiRequest<OtpRequestResult>("/api/auth/otp/request", { ...open, body: { email } });
}

export function verifyTextCode(challengeToken: string, code: string): Promise<SignedIn> {
  return apiRequest<SignedIn>("/api/auth/otp/verify", { ...open, body: { challengeToken, code } });
}

// Verifying the phone used for text sign-in (signed in).
export function startPhoneVerification(phone: string): Promise<{ challengeToken: string; maskedPhone: string }> {
  return apiRequest("/api/auth/phone/start", { method: "POST", body: { phone } });
}

export function confirmPhoneVerification(challengeToken: string, code: string): Promise<{ ok: true; user: User }> {
  return apiRequest("/api/auth/phone/confirm", { method: "POST", body: { challengeToken, code } });
}

export interface PasskeyInfo {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function listPasskeys(): Promise<PasskeyInfo[]> {
  return apiRequest<PasskeyInfo[]>("/api/auth/passkeys");
}

export function deletePasskey(id: string): Promise<void> {
  return apiRequest<void>(`/api/auth/passkeys/${id}`, { method: "DELETE" });
}

export function passkeyRegisterOptions(): Promise<{ options: unknown; challengeId: string }> {
  return apiRequest("/api/auth/passkey/register/options", { method: "POST" });
}

export function passkeyRegisterVerify(challengeId: string, response: unknown, deviceName?: string): Promise<{ ok: true }> {
  return apiRequest("/api/auth/passkey/register/verify", { method: "POST", body: { challengeId, response, deviceName } });
}

export function passkeyLoginOptions(): Promise<{ options: unknown; challengeId: string }> {
  return apiRequest("/api/auth/passkey/login/options", { ...open, body: {} });
}

export function passkeyLoginVerify(challengeId: string, response: unknown): Promise<SignedIn> {
  return apiRequest<SignedIn>("/api/auth/passkey/login/verify", { ...open, body: { challengeId, response } });
}

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

export function resendMfaCode(challengeToken: string): Promise<{ ok: true; maskedPhone?: string; maskedEmail?: string }> {
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
