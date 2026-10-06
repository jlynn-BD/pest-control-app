import jwt from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
// A separate key (derived, so Render needs no new env var) for the
// half-finished-login token: it must never be accepted as an access token.
const CHALLENGE_SECRET = `${ACCESS_SECRET}:challenge`;

export const ACCESS_TOKEN_TTL = "15m";
// Idle limit: a session not used for this long dies and needs a full sign-in
// (password + second factor). Each refresh slides it forward...
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// ...but only up to this absolute limit from the original sign-in, so a
// remembered session can never be kept alive forever.
export const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_DAYS || 30) * 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 15 * 60 * 1000;

// When true (the default) every account must have a second factor and no
// session without one is honoured. MFA_ENFORCED=false is an emergency switch.
export const MFA_ENFORCED = process.env.MFA_ENFORCED !== "false";

export interface AccessTokenPayload {
  sub: string;
  role: string;
  // true only when this sign-in completed the second factor
  mfa: boolean;
  // refresh-token family (the sign-in this access token belongs to)
  sid?: string;
  iat?: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: Math.floor(REFRESH_TOKEN_TTL_MS / 1000) });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
}

export interface ChallengePayload {
  cid: string;
  sub: string;
}

export function signChallengeToken(payload: ChallengePayload): string {
  return jwt.sign(payload, CHALLENGE_SECRET, { expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000) });
}

export function verifyChallengeToken(token: string): ChallengePayload {
  return jwt.verify(token, CHALLENGE_SECRET) as ChallengePayload;
}
