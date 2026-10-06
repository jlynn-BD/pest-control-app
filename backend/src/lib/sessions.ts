import { prisma } from "./prisma";

// Ends a person's sessions: every refresh token is revoked (optionally sparing
// one sign-in, e.g. the device that just changed the password) AND any access
// token issued before now is refused, so it takes effect immediately.
export async function revokeUserSessions(userId: string, exceptFamilyId?: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { OR: [{ familyId: null }, { familyId: { not: exceptFamilyId } }] } : {}),
      },
      data: { revokedAt: now },
    }),
    prisma.user.update({ where: { id: userId }, data: { sessionsValidAfter: now } }),
  ]);
}
