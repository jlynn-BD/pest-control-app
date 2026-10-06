// Text-message delivery. Twilio is the provider (its plain Messages REST API,
// no SDK needed). Nothing is sent until the three env vars below are set on
// the backend; until then smsAvailable() is false and the app only offers the
// authenticator-app method.
//
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER            (a Twilio number in E.164, e.g. +15551234567)
//     or TWILIO_MESSAGING_SERVICE_SID
//
// SMS_MODE=console prints the code to the server log instead of sending - for
// local testing only; it is ignored when NODE_ENV=production.

export function smsAvailable(): boolean {
  if (consoleMode()) return true;
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)
  );
}

function consoleMode(): boolean {
  return process.env.SMS_MODE === "console" && process.env.NODE_ENV !== "production";
}

// Test hook: the last message "sent" in console mode, so automated tests can
// read the code without a phone.
export const lastConsoleSms: { to: string; body: string } = { to: "", body: "" };

export async function sendSms(to: string, body: string): Promise<void> {
  if (consoleMode()) {
    lastConsoleSms.to = to;
    lastConsoleSms.body = body;
    // eslint-disable-next-line no-console
    console.log(`[sms:console] to ${to}: ${body}`);
    return;
  }
  if (!smsAvailable()) throw new Error("SMS is not configured");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM_NUMBER!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    // Log Twilio's reason server-side; never put provider detail in the response.
    // eslint-disable-next-line no-console
    console.error("SMS send failed", res.status, await res.text().catch(() => ""));
    throw new Error("Could not send the text message");
  }
}

// US numbers are the norm for Blue Duck: 10 digits (or 1 + 10) become +1...;
// anything already starting with + must be a plausible E.164 number.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function maskPhone(e164: string): string {
  return `•••-•••-${e164.slice(-4)}`;
}
