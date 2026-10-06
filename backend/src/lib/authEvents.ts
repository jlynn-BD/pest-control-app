import type { Request } from "express";
import { prisma } from "./prisma";
import { generateId } from "./id";

export type AuthEventType =
  | "LOGIN_PASSWORD_FAILED"
  | "LOGIN_LOCKED"
  | "LOGIN_SUCCESS"
  | "MFA_FAILED"
  | "MFA_ENROLLED"
  | "PASSWORD_CHANGED"
  | "SESSION_REUSE_DETECTED"
  | "LOGOUT_ALL"
  | "USER_CREATED"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED"
  | "ADMIN_PASSWORD_RESET"
  | "ADMIN_MFA_RESET"
  | "ADMIN_UNLOCKED"
  | "ROLE_CHANGED";

export function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: (req.headers["user-agent"] ?? "").toString().slice(0, 200) || null };
}

// Fire-and-forget by design: a failure to write the audit row must never
// block (or break) the sign-in it describes.
export function recordAuthEvent(req: Request, type: AuthEventType, data: { userId?: string | null; email?: string | null; detail?: string } = {}) {
  const { ip, userAgent } = clientInfo(req);
  prisma.authEvent
    .create({ data: { id: generateId(), type, userId: data.userId ?? null, email: data.email ?? null, detail: data.detail ?? null, ip, userAgent } })
    .catch((err) => console.error("authEvent write failed", err));
}
