import type { NextFunction, Request, Response } from "express";
import { MFA_ENFORCED, verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { HttpError } from "./error-handler";

export interface AuthUser {
  id: string;
  role: string;
  // refresh-token family of the sign-in this request belongs to
  sessionId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new HttpError(401, "Missing bearer token"));
    return;
  }
  let payload;
  try {
    payload = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
    return;
  }
  // A token minted without the second factor (e.g. a session that predates
  // MFA) is not honoured once MFA is required.
  if (MFA_ENFORCED && !payload.mfa) {
    next(new HttpError(401, "Invalid or expired token"));
    return;
  }
  // Checked against the database on every request (one primary-key lookup) so
  // that deactivating someone or changing their role takes effect at once,
  // instead of after the access token's 15 minutes run out.
  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { id: true, role: true, active: true, sessionsValidAfter: true } })
    .then((user) => {
      if (!user || !user.active) {
        next(new HttpError(401, "Invalid or expired token"));
        return;
      }
      // Issued before this person's sessions were last revoked (logout-all,
      // password change, admin reset): refuse. iat is whole seconds.
      if (user.sessionsValidAfter && (payload.iat ?? 0) * 1000 < user.sessionsValidAfter.getTime() - 1000) {
        next(new HttpError(401, "Invalid or expired token"));
        return;
      }
      req.user = { id: user.id, role: user.role, sessionId: payload.sid };
      next();
    })
    .catch(next);
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, "Insufficient permissions");
    }
    next();
  };
}
