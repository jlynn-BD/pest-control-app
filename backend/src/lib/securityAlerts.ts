import type { Request } from "express";
import { prisma } from "./prisma";
import { emailAvailable, sendEmail } from "./email";
import { clientInfo } from "./audit";
import type { AuthEventType } from "./authEvents";

// Emails people when something security-relevant happens, so a problem is
// noticed in minutes instead of whenever someone next reads the activity log:
//
//   - admins hear about people being added, removed, re-enabled or given a
//     different role, passwords / second steps being reset, and accounts being
//     locked or a stolen sign-in being replayed;
//   - a person hears about a sign-in to their own account from a device that
//     has not signed in to it before, and about changes to their own
//     sign-in methods.
//
// Best-effort and silent: no email provider, or a failed send, never affects
// the action itself. SECURITY_ALERTS=false switches it all off.

const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number>();

// The same alert about the same account is not repeated within 10 minutes
// (a locked-out account would otherwise mail admins on every attempt).
function throttled(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > WINDOW_MS) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

// Demo accounts have no real mailbox.
function isRealEmail(email: string): boolean {
  return !email.toLowerCase().endsWith("@pestapp.dev") && !email.toLowerCase().endsWith(".test");
}

function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "an unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
  return `${browser} on ${os}`;
}

async function adminEmails(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true } });
  return admins.map((a) => a.email).filter(isRealEmail);
}

const ADMIN_ALERTS: Partial<Record<AuthEventType, (who: string, by: string, detail?: string) => { subject: string; body: string }>> = {
  USER_CREATED: (who, by) => ({ subject: `New team member added: ${who}`, body: `${by} added ${who} to PestApp.` }),
  USER_DELETED: (who, by) => ({ subject: `Account deleted: ${who}`, body: `${by} permanently deleted the account of ${who}.` }),
  USER_REACTIVATED: (who, by) => ({ subject: `Access turned back on: ${who}`, body: `${by} turned access back on for ${who}.` }),
  ROLE_CHANGED: (who, by, detail) => ({ subject: `Role changed for ${who}`, body: `${by} changed the role of ${who} (${detail ?? "unknown"}).` }),
  ADMIN_PASSWORD_RESET: (who, by) => ({ subject: `Temporary password issued for ${who}`, body: `${by} issued a new temporary password for ${who}.` }),
  ADMIN_MFA_RESET: (who, by) => ({ subject: `Two-step sign-in reset for ${who}`, body: `${by} reset the two-step sign-in of ${who}.` }),
  LOGIN_LOCKED: (who) => ({ subject: `Account locked after failed sign-ins: ${who}`, body: `${who} was locked for 15 minutes after repeated wrong passwords or codes. If this was not them, someone may be trying to get in.` }),
  SESSION_REUSE_DETECTED: (who) => ({ subject: `Possible stolen sign-in: ${who}`, body: `A sign-in session for ${who} was used twice, which can mean it was copied. All of that person's sessions were ended.` }),
};

const OWNER_ALERTS: Partial<Record<AuthEventType, { subject: string; body: string }>> = {
  PASSKEY_ADDED: { subject: "Fingerprint / Face unlock added to your PestApp account", body: "Fingerprint or Face unlock was turned on for your account." },
  PASSKEY_REMOVED: { subject: "Fingerprint / Face unlock removed from your PestApp account", body: "Fingerprint or Face unlock was removed from your account." },
  PASSWORD_CHANGED: { subject: "Your PestApp password was changed", body: "The password on your account was changed." },
  ADMIN_PASSWORD_RESET: { subject: "An admin reset your PestApp password", body: "An admin issued you a new temporary password." },
  ADMIN_MFA_RESET: { subject: "An admin reset your PestApp two-step sign-in", body: "An admin reset the two-step sign-in on your account." },
};

const FOOTER = "\n\nIf this was not expected, open PestApp -> Settings -> Team (admins) or tell an admin right away so the account can be turned off.";

async function sendAll(to: string[], subject: string, body: string) {
  for (const address of to) {
    try {
      await sendEmail(address, `[PestApp security] ${subject}`, `${body}${FOOTER}`);
    } catch (err) {
      console.error("security alert email failed", err instanceof Error ? err.message : err);
    }
  }
}

// Called once the event row is saved (so "have we seen this device before"
// can include or exclude the current sign-in deterministically).
export async function notifySecurityEvent(
  req: Request,
  type: AuthEventType,
  data: { userId?: string | null; email?: string | null; detail?: string }
): Promise<void> {
  if (process.env.SECURITY_ALERTS === "false" || !emailAvailable()) return;
  const when = new Date().toUTCString();
  const { ip, userAgent } = clientInfo(req);
  const who = data.email ?? "an account";
  const by = req.user?.name || "An admin";

  const adminAlert = ADMIN_ALERTS[type];
  if (adminAlert) {
    if (throttled(`admin:${type}:${data.userId ?? data.email ?? ""}`)) return;
    const { subject, body } = adminAlert(who, by, data.detail);
    const to = await adminEmails();
    if (to.length) await sendAll(to, subject, `${body}\n\nWhen: ${when}\nFrom: ${describeDevice(userAgent)} (${ip ?? "unknown address"})`);
  }

  const ownerAlert = OWNER_ALERTS[type];
  if (ownerAlert && data.email && isRealEmail(data.email) && !throttled(`owner:${type}:${data.userId ?? data.email}`)) {
    await sendAll([data.email], ownerAlert.subject, `${ownerAlert.body}\n\nWhen: ${when}\nFrom: ${describeDevice(userAgent)} (${ip ?? "unknown address"})`);
  }

  // A sign-in from a device that has never signed in to this account before
  // (the very first sign-in ever is not "new" - everything is).
  if (type === "LOGIN_SUCCESS" && data.userId && userAgent) {
    const [sameDevice, total] = await Promise.all([
      prisma.authEvent.count({ where: { userId: data.userId, type: "LOGIN_SUCCESS", userAgent } }),
      prisma.authEvent.count({ where: { userId: data.userId, type: "LOGIN_SUCCESS" } }),
    ]);
    if (sameDevice <= 1 && total > 1) {
      const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { email: true } });
      if (user && isRealEmail(user.email) && !throttled(`device:${data.userId}:${userAgent}`)) {
        await sendAll(
          [user.email],
          "New sign-in to your PestApp account",
          `Your account was just signed in to from a device it has not been used on before.\n\nDevice: ${describeDevice(userAgent)}\nWhen: ${when}\nAddress: ${ip ?? "unknown"}`
        );
      }
    }
  }
}
