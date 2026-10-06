import type { LoginChallenge, User } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { comparePassword, hashPassword, sha256 } from "../../lib/password";
import { validatePassword } from "../../lib/passwordPolicy";
import {
  CHALLENGE_TTL_MS,
  MFA_ENFORCED,
  REFRESH_TOKEN_TTL_MS,
  SESSION_MAX_AGE_MS,
  signAccessToken,
  signChallengeToken,
  signRefreshToken,
  verifyChallengeToken,
  verifyRefreshToken,
} from "../../lib/jwt";
import { decryptSecret, encryptSecret, hashCode, randomDigits, randomReadable, safeEqual } from "../../lib/crypto";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../../lib/totp";
import { maskPhone, normalizePhone, sendSms, smsAvailable } from "../../lib/sms";
import { clientInfo, recordAuthEvent } from "../../lib/authEvents";
import { rateLimit } from "../../lib/rateLimit";
import { revokeUserSessions } from "../../lib/sessions";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

export const authRouter = Router();

// ---- tunables ------------------------------------------------------------

const MAX_CODE_ATTEMPTS = 5; // wrong codes allowed per half-finished sign-in
const MAX_FAILED_BEFORE_LOCK = 5; // wrong passwords/codes before the account locks
const LOCK_MS = 15 * 60 * 1000;
const SMS_CODE_TTL_MS = 5 * 60 * 1000;
const SMS_RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_SMS_SENDS = 5; // per half-finished sign-in
const RECOVERY_CODE_COUNT = 10;
// A refresh token re-presented this soon after it was rotated is almost
// certainly the same device retrying after a lost response (bad signal), not
// a thief; anything later is treated as reuse and the session is revoked.
const REFRESH_REPLAY_GRACE_MS = 60 * 1000;

const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE_LIMIT_MAX || 40) });
const GENERIC_LOGIN_ERROR = "Incorrect email or password.";
// Compared against when the email doesn't exist, so that "unknown email"
// takes as long as "wrong password" (no way to probe which emails are real).
const DUMMY_HASH = hashPassword("not-a-real-password-just-for-timing");

// ---- shapes returned to the client ---------------------------------------

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    phone: user.phone,
    active: user.active,
    mfaMethod: user.mfaMethod,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

type NextStep = "password_change" | "mfa_enroll" | "mfa_verify";

function stepBody(user: User, challenge: LoginChallenge, next: NextStep) {
  return {
    status: "challenge" as const,
    challengeToken: signChallengeToken({ cid: challenge.id, sub: user.id }),
    next,
    method: next === "mfa_verify" ? user.mfaMethod : challenge.pendingMethod,
    maskedPhone:
      next === "mfa_verify" && user.mfaMethod === "SMS" && user.phone
        ? maskPhone(normalizePhone(user.phone) ?? user.phone)
        : challenge.pendingPhone
          ? maskPhone(challenge.pendingPhone)
          : null,
    smsAvailable: smsAvailable(),
    expiresAt: challenge.expiresAt,
  };
}

// ---- sessions ------------------------------------------------------------

async function issueTokens(
  req: Request,
  user: User,
  session: { familyId?: string; sessionStartedAt?: Date; mfaVerifiedAt: Date | null }
) {
  const tokenId = generateId();
  const familyId = session.familyId ?? generateId();
  const refreshToken = signRefreshToken({ sub: user.id, tokenId });
  const { ip, userAgent } = clientInfo(req);
  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      familyId,
      sessionStartedAt: session.sessionStartedAt ?? new Date(),
      mfaVerifiedAt: session.mfaVerifiedAt,
      lastUsedAt: new Date(),
      ip,
      userAgent,
    },
  });
  const accessToken = signAccessToken({ sub: user.id, role: user.role, mfa: Boolean(session.mfaVerifiedAt), sid: familyId });
  return { accessToken, refreshToken };
}

// ---- half-finished sign-ins ----------------------------------------------

async function createChallenge(req: Request, user: User) {
  const { ip, userAgent } = clientInfo(req);
  return prisma.loginChallenge.create({
    data: { id: generateId(), userId: user.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS), ip, userAgent },
  });
}

const challengeSchema = z.object({ challengeToken: z.string().min(10) });

async function loadChallenge(token: string): Promise<{ challenge: LoginChallenge; user: User }> {
  let payload;
  try {
    payload = verifyChallengeToken(token);
  } catch {
    throw new HttpError(401, "Your sign-in timed out. Please start again.");
  }
  const challenge = await prisma.loginChallenge.findUnique({ where: { id: payload.cid } });
  if (!challenge || challenge.userId !== payload.sub || challenge.consumedAt || challenge.expiresAt < new Date()) {
    throw new HttpError(401, "Your sign-in timed out. Please start again.");
  }
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
    throw new HttpError(401, "Too many incorrect codes. Please start again.");
  }
  const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
  if (!user || !user.active) throw new HttpError(401, "Your sign-in timed out. Please start again.");
  if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
  return { challenge, user };
}

function lockedError(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
}

// One more wrong password/code against this account. Locks it after a few so
// a stolen password can't be used to guess the second factor.
async function registerFailure(req: Request, user: User, challenge: LoginChallenge | null, type: "LOGIN_PASSWORD_FAILED" | "MFA_FAILED") {
  const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
  if (challenge) await prisma.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
  recordAuthEvent(req, type, { userId: user.id, email: user.email });
  if (updated.failedLoginCount >= MAX_FAILED_BEFORE_LOCK) {
    const until = new Date(Date.now() + LOCK_MS);
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: until, failedLoginCount: 0 } });
    recordAuthEvent(req, "LOGIN_LOCKED", { userId: user.id, email: user.email });
    throw lockedError(until);
  }
}

// Marks the challenge used exactly once - two requests racing with the same
// correct code can't both turn it into a session.
async function consumeChallenge(challengeId: string) {
  const res = await prisma.loginChallenge.updateMany({ where: { id: challengeId, consumedAt: null }, data: { consumedAt: new Date() } });
  if (res.count !== 1) throw new HttpError(401, "Your sign-in timed out. Please start again.");
}

async function sendSmsCode(user: { id: string }, challenge: LoginChallenge, phone: string) {
  if (challenge.lastSentAt && Date.now() - challenge.lastSentAt.getTime() < SMS_RESEND_COOLDOWN_MS) {
    throw new HttpError(429, "Please wait a few seconds before asking for another text.");
  }
  if (challenge.sends >= MAX_SMS_SENDS) throw new HttpError(429, "Too many texts requested. Please sign in again.");
  const code = randomDigits(6);
  try {
    await sendSms(phone, `Your Blue Duck PestApp code is ${code}. It expires in 5 minutes. Never share this code.`);
  } catch {
    throw new HttpError(502, "We couldn't send the text message. Please try again, or use an authenticator app.");
  }
  return prisma.loginChallenge.update({
    where: { id: challenge.id },
    data: { codeHash: hashCode(code), lastSentAt: new Date(), sends: { increment: 1 } },
  });
}

// Decides what the person must do next, or finishes the sign-in.
async function advance(req: Request, user: User, challenge: LoginChallenge) {
  if (user.mustChangePassword) return stepBody(user, challenge, "password_change");
  if (user.mfaMethod) {
    let current = challenge;
    if (user.mfaMethod === "SMS" && !challenge.codeHash) {
      const phone = user.phone ? normalizePhone(user.phone) : null;
      if (!phone) throw new HttpError(400, "No valid phone number on file. Ask an admin to reset your sign-in.");
      current = await sendSmsCode(user, challenge, phone);
    }
    return stepBody(user, current, "mfa_verify");
  }
  if (MFA_ENFORCED) return stepBody(user, challenge, "mfa_enroll");
  return completeSignIn(req, user, challenge, false);
}

async function completeSignIn(req: Request, user: User, challenge: LoginChallenge, mfaVerified: boolean, extra: Record<string, unknown> = {}) {
  await consumeChallenge(challenge.id);
  const fresh = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const tokens = await issueTokens(req, fresh, { mfaVerifiedAt: mfaVerified ? new Date() : null });
  recordAuthEvent(req, "LOGIN_SUCCESS", { userId: user.id, email: user.email, detail: mfaVerified ? "mfa" : "no-mfa" });
  return { status: "ok" as const, ...tokens, user: toPublicUser(fresh), ...extra };
}

function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomReadable(10).toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { plain, hashes: plain.map((c) => hashCode(c)) };
}

// ---- POST /login ----------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
    if (!user || !user.active) {
      await comparePassword(password, await DUMMY_HASH);
      recordAuthEvent(req, "LOGIN_PASSWORD_FAILED", { email: email.slice(0, 120), detail: user ? "inactive" : "unknown" });
      throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      await registerFailure(req, user, null, "LOGIN_PASSWORD_FAILED");
      throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    const challenge = await createChallenge(req, user);
    res.json(await advance(req, user, challenge));
  })
);

// ---- forced password change (temporary password) ---------------------------

authRouter.post(
  "/password/change-required",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { challengeToken, newPassword } = challengeSchema.extend({ newPassword: z.string().min(1) }).parse(req.body);
    const { challenge, user } = await loadChallenge(challengeToken);
    if (!user.mustChangePassword) throw new HttpError(400, "No password change is required.");
    const problem = validatePassword(newPassword, user);
    if (problem) throw new HttpError(400, problem);
    if (await comparePassword(newPassword, user.passwordHash)) throw new HttpError(400, "Choose a new password, different from the temporary one.");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
    });
    await revokeUserSessions(user.id);
    recordAuthEvent(req, "PASSWORD_CHANGED", { userId: user.id, email: user.email, detail: "temporary password replaced" });
    res.json(await advance(req, updated, challenge));
  })
);

// ---- MFA enrollment --------------------------------------------------------

authRouter.post(
  "/mfa/enroll/start",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const body = challengeSchema.extend({ method: z.enum(["TOTP", "SMS"]), phone: z.string().optional() }).parse(req.body);
    const { challenge, user } = await loadChallenge(body.challengeToken);
    if (user.mustChangePassword) throw new HttpError(400, "Change your temporary password first.");
    if (user.mfaMethod) throw new HttpError(400, "Two-step sign-in is already set up. Ask an admin to reset it.");

    if (body.method === "TOTP") {
      const secret = generateTotpSecret();
      await prisma.loginChallenge.update({
        where: { id: challenge.id },
        data: { pendingMethod: "TOTP", pendingTotpSecretEnc: encryptSecret(secret), pendingPhone: null, codeHash: null },
      });
      const url = otpauthUrl(secret, user.email);
      res.json({ method: "TOTP", secret: secret.match(/.{1,4}/g)!.join(" "), otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
      return;
    }

    if (!smsAvailable()) throw new HttpError(400, "Text-message codes aren't available yet. Use an authenticator app.");
    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (!phone) throw new HttpError(400, "Enter a valid mobile number, for example 555-123-4567.");
    const updated = await prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { pendingMethod: "SMS", pendingPhone: phone, pendingTotpSecretEnc: null },
    });
    await sendSmsCode(user, updated, phone);
    res.json({ method: "SMS", maskedPhone: maskPhone(phone) });
  })
);

authRouter.post(
  "/mfa/enroll/confirm",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { challengeToken, code } = challengeSchema.extend({ code: z.string().min(1) }).parse(req.body);
    const { challenge, user } = await loadChallenge(challengeToken);
    if (user.mfaMethod || user.mustChangePassword || !challenge.pendingMethod) throw new HttpError(400, "Start two-step setup first.");

    let ok = false;
    let totpStep: number | null = null;
    if (challenge.pendingMethod === "TOTP" && challenge.pendingTotpSecretEnc) {
      totpStep = verifyTotp(decryptSecret(challenge.pendingTotpSecretEnc), code);
      ok = totpStep !== null;
    } else if (challenge.pendingMethod === "SMS") {
      ok = smsCodeMatches(challenge, code);
    }
    if (!ok) {
      await registerFailure(req, user, challenge, "MFA_FAILED");
      throw new HttpError(401, "That code isn't right. Check it and try again.");
    }

    const recovery = generateRecoveryCodes();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data:
        challenge.pendingMethod === "TOTP"
          ? {
              mfaMethod: "TOTP",
              totpSecretEnc: challenge.pendingTotpSecretEnc,
              totpLastStep: totpStep,
              mfaEnrolledAt: new Date(),
              recoveryCodeHashes: JSON.stringify(recovery.hashes),
            }
          : {
              mfaMethod: "SMS",
              phone: challenge.pendingPhone,
              phoneVerifiedAt: new Date(),
              totpSecretEnc: null,
              mfaEnrolledAt: new Date(),
              recoveryCodeHashes: JSON.stringify(recovery.hashes),
            },
    });
    recordAuthEvent(req, "MFA_ENROLLED", { userId: user.id, email: user.email, detail: challenge.pendingMethod });
    // The recovery codes are shown to the person exactly once, here.
    res.json(await completeSignIn(req, updated, challenge, true, { recoveryCodes: recovery.plain }));
  })
);

function smsCodeMatches(challenge: LoginChallenge, code: string): boolean {
  if (!challenge.codeHash || !challenge.lastSentAt) return false;
  if (Date.now() - challenge.lastSentAt.getTime() > SMS_CODE_TTL_MS) return false;
  return safeEqual(challenge.codeHash, hashCode(code.replace(/\s+/g, "")));
}

// ---- MFA verify (every sign-in) --------------------------------------------

authRouter.post(
  "/mfa/verify",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { challengeToken, code } = challengeSchema.extend({ code: z.string().min(1).max(40) }).parse(req.body);
    const { challenge, user } = await loadChallenge(challengeToken);
    if (user.mustChangePassword || !user.mfaMethod) throw new HttpError(400, "Two-step sign-in isn't ready for this account.");

    const compact = code.replace(/\s+/g, "");
    let ok = false;
    let usedRecovery = false;

    if (/^\d{6}$/.test(compact)) {
      if (user.mfaMethod === "TOTP" && user.totpSecretEnc) {
        const step = verifyTotp(decryptSecret(user.totpSecretEnc), compact);
        if (step !== null) {
          // Each 30-second code works once: refuse a step we've already accepted.
          const claimed = await prisma.user.updateMany({
            where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
            data: { totpLastStep: step },
          });
          ok = claimed.count === 1;
        }
      } else if (user.mfaMethod === "SMS") {
        ok = smsCodeMatches(challenge, compact);
      }
    } else {
      // Not six digits: treat it as a one-time recovery code.
      const hashes: string[] = JSON.parse(user.recoveryCodeHashes || "[]");
      const h = hashCode(compact.toUpperCase());
      const idx = hashes.findIndex((x) => safeEqual(x, h));
      if (idx !== -1) {
        const remaining = hashes.filter((_, i) => i !== idx);
        const claimed = await prisma.user.updateMany({
          where: { id: user.id, recoveryCodeHashes: user.recoveryCodeHashes },
          data: { recoveryCodeHashes: JSON.stringify(remaining) },
        });
        ok = claimed.count === 1;
        usedRecovery = ok;
      }
    }

    if (!ok) {
      await registerFailure(req, user, challenge, "MFA_FAILED");
      throw new HttpError(401, "That code isn't right. Check it and try again.");
    }
    const response = await completeSignIn(req, user, challenge, true);
    if (usedRecovery) {
      recordAuthEvent(req, "LOGIN_SUCCESS", { userId: user.id, email: user.email, detail: "recovery code used" });
    }
    res.json(response);
  })
);

authRouter.post(
  "/mfa/resend",
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { challengeToken } = challengeSchema.parse(req.body);
    const { challenge, user } = await loadChallenge(challengeToken);
    const phone = user.mfaMethod === "SMS" ? (user.phone ? normalizePhone(user.phone) : null) : challenge.pendingMethod === "SMS" ? challenge.pendingPhone : null;
    if (!phone) throw new HttpError(400, "Text messages aren't used for this sign-in.");
    await sendSmsCode(user, challenge, phone);
    res.json({ ok: true, maskedPhone: maskPhone(phone) });
  })
);

// ---- refresh / logout ------------------------------------------------------

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, "Invalid refresh token");
    }
    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.tokenId } });
    if (!stored || stored.tokenHash !== sha256(refreshToken) || stored.expiresAt < new Date()) {
      throw new HttpError(401, "Refresh token expired or revoked");
    }
    if (stored.revokedAt) {
      // Revoked by logout / password change / an admin: just refuse. Only a
      // token spent by a normal refresh can indicate a copied token: right
      // after the rotation it's a device retrying a lost response (tell it to
      // retry); later it may be a thief's copy, so end the whole session.
      if (!stored.rotatedAt) throw new HttpError(401, "Refresh token expired or revoked");
      if (Date.now() - stored.rotatedAt.getTime() < REFRESH_REPLAY_GRACE_MS) throw new HttpError(409, "Session is refreshing - retry");
      if (stored.familyId) {
        await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        recordAuthEvent(req, "SESSION_REUSE_DETECTED", { userId: stored.userId });
      }
      throw new HttpError(401, "Refresh token expired or revoked");
    }
    // Absolute lifetime: sliding renewals can't extend a session past this.
    if (Date.now() - stored.sessionStartedAt.getTime() > SESSION_MAX_AGE_MS) {
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      throw new HttpError(401, "Session expired - please sign in again");
    }
    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.active) throw new HttpError(401, "Account disabled");
    // A session that never completed the second factor must not renew.
    if ((MFA_ENFORCED || user.mfaMethod) && !stored.mfaVerifiedAt) throw new HttpError(401, "Please sign in again");
    if (user.mustChangePassword) throw new HttpError(401, "Please sign in again");

    // Rotate: the old token is spent the instant it's used (conditional update
    // so two simultaneous refreshes can't both succeed).
    const spent = await prisma.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date(), rotatedAt: new Date(), lastUsedAt: new Date() } });
    if (spent.count !== 1) throw new HttpError(409, "Session is refreshing - retry");
    const tokens = await issueTokens(req, user, {
      familyId: stored.familyId ?? stored.id,
      sessionStartedAt: stored.sessionStartedAt,
      mfaVerifiedAt: stored.mfaVerifiedAt,
    });
    res.json({ ...tokens, user: toPublicUser(user) });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    try {
      const payload = verifyRefreshToken(refreshToken);
      const stored = await prisma.refreshToken.findUnique({ where: { id: payload.tokenId } });
      if (stored) {
        await prisma.refreshToken.updateMany({
          where: stored.familyId ? { familyId: stored.familyId, revokedAt: null } : { id: stored.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // token already invalid/expired - logout is idempotent either way
    }
    res.status(204).send();
  })
);

// ---- signed-in account actions ---------------------------------------------

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(404, "User not found");
    res.json(toPublicUser(user));
  })
);

authRouter.post(
  "/password",
  requireAuth,
  ipLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(404, "User not found");
    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      await registerFailure(req, user, null, "LOGIN_PASSWORD_FAILED");
      throw new HttpError(400, "Your current password isn't right.");
    }
    const problem = validatePassword(newPassword, user);
    if (problem) throw new HttpError(400, problem);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
    // Every other signed-in device must sign in again with the new password.
    await revokeUserSessions(user.id, req.user!.sessionId);
    recordAuthEvent(req, "PASSWORD_CHANGED", { userId: user.id, email: user.email });
    res.json({ ok: true });
  })
);

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeUserSessions(req.user!.id);
    recordAuthEvent(req, "LOGOUT_ALL", { userId: req.user!.id });
    res.status(204).send();
  })
);
