// True on the deployed API. Render sets RENDER=true on every service even when
// NODE_ENV is not "production", so either one counts.
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.RENDER === "true";
}

// A signing/encryption secret from the environment. In development a fixed
// fallback keeps `npm run dev` working with no setup; deployed, a missing or
// placeholder secret stops the server from starting rather than quietly
// signing sessions with a key that is public in the source code.
export function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length >= 16 && value !== devFallback && !value.startsWith("change-me")) return value;
  if (isProduction()) throw new Error(`${name} must be set to a long random value (16+ characters) before the API can start.`);
  return value || devFallback;
}
