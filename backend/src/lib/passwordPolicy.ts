// Deliberately simple, current-guidance rules (length over symbol rules):
// 10+ characters, not one of the obvious ones, not built from the account's
// own email/name.
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd123", "1234567890", "qwertyuiop", "letmein123",
  "welcome123", "admin12345", "iloveyou12", "blueduck123", "pestapp123", "pestcontrol",
]);

export function validatePassword(password: string, context: { email?: string; firstName?: string; lastName?: string } = {}): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password is too long (128 characters max).";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Pick something less guessable.";
  if (/^(.)\1+$/.test(password)) return "Password can't be one repeated character.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Password can't contain your email name.";
  for (const part of [context.firstName, context.lastName]) {
    if (part && part.length >= 4 && lower.includes(part.toLowerCase())) return "Password can't contain your name.";
  }
  return null;
}
