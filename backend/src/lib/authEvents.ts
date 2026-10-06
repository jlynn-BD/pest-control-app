import type { Request } from "express";
import { prisma } from "./prisma";
import { generateId } from "./id";
import { clientInfo, logActivity } from "./audit";

export { clientInfo };

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
  | "USER_DELETED"
  | "USER_REACTIVATED"
  | "ADMIN_PASSWORD_RESET"
  | "ADMIN_MFA_RESET"
  | "ADMIN_UNLOCKED"
  | "ROLE_CHANGED";

// Fire-and-forget by design: a failure to write the audit row must never
// block (or break) the sign-in it describes.
export function recordAuthEvent(req: Request, type: AuthEventType, data: { userId?: string | null; email?: string | null; detail?: string } = {}) {
  recordAccountActivity(req, type, data);
  const { ip, userAgent } = clientInfo(req);
  prisma.authEvent
    .create({ data: { id: generateId(), type, userId: data.userId ?? null, email: data.email ?? null, detail: data.detail ?? null, ip, userAgent } })
    .catch((err) => console.error("authEvent write failed", err));
}

// Account-management actions also go in the main audit trail, so "who added or
// turned off whom" reads in the same timeline as everything else.
const ACCOUNT_SUMMARY: Partial<Record<AuthEventType, (who: string, detail?: string) => string>> = {
  USER_CREATED: (who) => `added a team member: ${who}`,
  USER_DEACTIVATED: (who) => `turned off access for ${who}`,
  USER_REACTIVATED: (who) => `turned access back on for ${who}`,
  USER_DELETED: (who) => `permanently deleted the account of ${who}`,
  ROLE_CHANGED: (who, detail) => `changed the role of ${who} (${detail ?? ""})`,
  ADMIN_PASSWORD_RESET: (who) => `issued a new temporary password for ${who}`,
  ADMIN_MFA_RESET: (who) => `reset two-step sign-in for ${who}`,
  ADMIN_UNLOCKED: (who) => `unlocked the account of ${who}`,
};

export function recordAccountActivity(req: Request, type: AuthEventType, data: { userId?: string | null; email?: string | null; detail?: string }) {
  const summary = ACCOUNT_SUMMARY[type];
  if (!summary || !req.user) return;
  void logActivity(req, {
    action: `user.${type.toLowerCase()}`,
    entityType: "User",
    entityId: data.userId ?? null,
    label: data.email ?? null,
    summary: summary(data.email ?? "someone", data.detail),
  });
}
