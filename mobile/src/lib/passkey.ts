import { Platform } from "react-native";

// Face ID / Touch ID / screen-lock sign-in, using the browser's passkey
// support (WebAuthn). It only exists in the web app (open in the browser or
// installed to the home screen); the browser asks for Face ID or a fingerprint
// itself and the secret never leaves the device.

const HINT_KEY = "pestapp.passkey.thisDevice";
const DISMISSED_KEY = "pestapp.easysignin.dismissed";

function webCrypto(): any {
  return typeof window !== "undefined" ? window : null;
}

export function passkeysSupported(): boolean {
  const w = webCrypto();
  return Platform.OS === "web" && Boolean(w && w.PublicKeyCredential && w.isSecureContext && navigator.credentials);
}

// True when this device can unlock a passkey with Face ID / fingerprint / screen lock.
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await (window as any).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Remembers (on this device only) that Face ID sign-in was turned on here,
// so the sign-in screen can lead with it. Never required for it to work.
export function rememberPasskeyOnThisDevice(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage can be unavailable (private window) - the hint is optional */
  }
}

export function hasPasskeyHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function easySignInDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissEasySignIn() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* optional */
  }
}

// ---- base64url <-> bytes ------------------------------------------------------

function toBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toB64url(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// What a person sees when they back out of the Face ID prompt vs. a real failure.
export class PasskeyCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

function asFriendly(err: unknown): never {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") throw new PasskeyCancelled();
  if (name === "InvalidStateError") throw new Error(`${biometricName()} is already turned on for this device.`);
  if (name === "NotSupportedError" || name === "SecurityError") {
    throw new Error(`${biometricName()} isn't available here. Open the app in Chrome or Safari, and make sure this device has a screen lock set.`);
  }
  throw new Error(`${biometricName()} isn't available here. Use your email instead.`);
}

// Turns the server's options into a real passkey on this device. Returns the
// JSON the server verifies.
export async function createPasskey(options: any): Promise<unknown> {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    user: { ...options.user, id: toBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((c: any) => ({ ...c, id: toBytes(c.id) })),
  };
  let cred: any;
  try {
    cred = await navigator.credentials.create({ publicKey });
  } catch (err) {
    asFriendly(err);
  }
  if (!cred) throw new PasskeyCancelled();
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      attestationObject: toB64url(cred.response.attestationObject),
      transports: cred.response.getTransports?.() ?? undefined,
    },
  };
}

// Asks the device to unlock the passkey it holds for this app.
export async function getPasskey(options: any): Promise<unknown> {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((c: any) => ({ ...c, id: toBytes(c.id) })),
  };
  let cred: any;
  try {
    cred = await navigator.credentials.get({ publicKey });
  } catch (err) {
    asFriendly(err);
  }
  if (!cred) throw new PasskeyCancelled();
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      authenticatorData: toB64url(cred.response.authenticatorData),
      signature: toB64url(cred.response.signature),
      userHandle: toB64url(cred.response.userHandle),
    },
  };
}

// What this device calls its biometric unlock, so the screens say the right
// thing: Face ID on an iPhone, fingerprint / face unlock on Android.
export function biometricName(): string {
  if (typeof navigator === "undefined") return "Biometric sign-in";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "Face ID";
  if (/iPad/.test(ua)) return "Face ID / Touch ID";
  if (/Android/.test(ua)) return "Fingerprint / Face Unlock";
  if (/Mac/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "Biometric sign-in";
}

// A readable name for "which device", e.g. "iPhone" or "Mac".
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) {
    const model = ua.match(/;\s*([^;)]+?)\s+Build\//)?.[1];
    const kind = /Mobile/.test(ua) ? "Android phone" : "Android tablet";
    return model && model.length < 30 && !/^Android/.test(model) ? `${kind} (${model})` : kind;
  }
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
