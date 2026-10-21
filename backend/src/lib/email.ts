// Email delivery for sign-in codes. Nothing is sent until one provider is
// configured on the backend (Render environment):
//
//   Option A - Resend (https://resend.com), plain HTTPS, nothing to install:
//     RESEND_API_KEY, EMAIL_FROM            e.g. "Blue Duck PestApp <signin@yourdomain.com>"
//   Option B - any SMTP mailbox (Google Workspace / Gmail app password, Outlook, SendGrid...):
//     SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, EMAIL_FROM
//
// EMAIL_MODE=console prints the message to the server log instead of sending -
// for local testing only; it is ignored when NODE_ENV=production.

function consoleMode(): boolean {
  return process.env.EMAIL_MODE === "console" && process.env.NODE_ENV !== "production";
}

function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM);
}

export function emailAvailable(): boolean {
  return consoleMode() || resendConfigured() || smtpConfigured();
}

// Test hook: the last message "sent" in console mode.
export const lastConsoleEmail: { to: string; subject: string; text: string } = { to: "", subject: "", text: "" };

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (consoleMode()) {
    lastConsoleEmail.to = to;
    lastConsoleEmail.subject = subject;
    lastConsoleEmail.text = text;
    // eslint-disable-next-line no-console
    console.log(`[email:console] to ${to}: ${subject} - ${text}`);
    return;
  }
  if (resendConfigured()) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("Email send failed (resend)", res.status, await res.text().catch(() => ""));
      throw new Error("Could not send the email");
    }
    return;
  }
  if (smtpConfigured()) {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      socketTimeout: 20000,
    });
    try {
      await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text, ...(html ? { html } : {}) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Email send failed (smtp)", err instanceof Error ? err.message : err);
      throw new Error("Could not send the email");
    }
    return;
  }
  throw new Error("Email is not configured");
}

// j***@example.com
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(name.length - 1, 5)))}@${domain}`;
}
