import type { Request } from "express";
import { prisma } from "./prisma";
import { EMAIL_HEADLINE_FONT, brandedEmail, emailAvailable, sendEmail } from "./email";
import { logActivity } from "./audit";
import { generateReportFor } from "../modules/reports/generate";

// Emails the customer their signed inspection report as soon as the job is
// finished: the technician has marked the inspection completed AND both the
// technician and the customer have signed. The address is the one on the
// customer's record (or, failing that, their primary contact).
//
// Every way an inspection can reach that state calls maybeEmailReportToCustomer
// (the signature upload, the Complete action, and the offline sync), so it
// works however the device sends things. A claim on Inspection.reportEmailedAt
// makes sure the customer gets it once even when two of those arrive together.
// Best-effort: a missing address or a failed send never affects the signing
// itself; the report card then offers "Email to customer" to try again.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Demo / reserved addresses have no real mailbox (and would bounce).
const FAKE_DOMAINS = ["example.com", "example.org", "example.net", "pestapp.dev"];
// Large enough for a photo-heavy report, small enough for any mailbox.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const RESEND_COOLDOWN_MS = 60 * 1000;

export function isRealCustomerEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.endsWith(".test") || e.endsWith(".invalid")) return false;
  return !FAKE_DOMAINS.some((d) => e.endsWith(`@${d}`));
}

export type CustomerEmailOutcome =
  | { sent: true; to: string }
  | { sent: false; reason: "not_ready" | "no_email" | "already_sent" | "not_configured" | "too_soon" | "failed" };

async function customerAddress(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true, contacts: { where: { deletedAt: null, email: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { email: true } } },
  });
  if (!customer) return null;
  if (isRealCustomerEmail(customer.email)) return customer.email.trim();
  const contact = customer.contacts.find((c) => isRealCustomerEmail(c.email));
  return contact?.email?.trim() ?? null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? "";
  return first && !/^(mr|mrs|ms|dr)\.?$/i.test(first) ? first : full.trim();
}

async function deliver(req: Request, inspectionId: string, to: string, generatedBy: string): Promise<void> {
  const { report, buffer } = await generateReportFor(inspectionId, generatedBy);
  const inspection = await prisma.inspection.findUniqueOrThrow({
    where: { id: inspectionId },
    include: { customer: true, property: true, technician: true },
  });
  const address = `${inspection.property.addressLine1}, ${inspection.property.city}, ${inspection.property.state} ${inspection.property.postalCode}`;
  const stamp = (inspection.completedAt ?? new Date()).toISOString().slice(0, 10);
  const tech = `${inspection.technician.firstName} ${inspection.technician.lastName}`;
  const attach = buffer.length <= MAX_ATTACHMENT_BYTES;
  const name = firstName(inspection.customer.name);

  const text =
    `Hi ${name},\n\nThank you for choosing Blue Duck Pest Control. ` +
    `Your pest inspection of ${address} was completed by ${tech}.\n\n` +
    (attach
      ? `Your signed inspection report is attached as a PDF. It lists what was checked, what was found, our recommendations, and the photos taken. Tap a photo in the PDF to see it larger.\n\n`
      : `Your signed inspection report is ready, but it is too large to attach. Reply to this email and we will send it another way.\n\n`) +
    `If you have any questions, just reply to this email or contact our office.\n\nBlue Duck Pest Control`;
  const html = brandedEmail(
    `<p style="font-family:${EMAIL_HEADLINE_FONT};font-size:18px;color:#002255;margin:0 0 16px">Your inspection report</p>` +
      `<p style="font-size:15px">Hi ${esc(name)},</p>` +
      `<p style="font-size:15px">Thank you for choosing Blue Duck Pest Control. Your pest inspection of <strong>${esc(address)}</strong> was completed by ${esc(tech)}.</p>` +
      (attach
        ? `<p style="font-size:15px">Your signed inspection report is attached as a PDF. It lists what was checked, what was found, our recommendations, and the photos taken. Tap a photo in the PDF to see it larger.</p>`
        : `<p style="font-size:15px">Your signed inspection report is ready, but it is too large to attach. Reply to this email and we will send it another way.</p>`) +
      `<p style="font-size:15px">If you have any questions, just reply to this email or contact our office.</p>` +
      `<p style="font-size:15px;color:#E67300;margin-top:20px"><strong>Blue Duck Pest Control</strong></p>`
  );

  await sendEmail(
    to,
    `Your Blue Duck Pest Control inspection report - ${inspection.property.addressLine1}`,
    text,
    html,
    attach ? [{ filename: `Blue-Duck-Inspection-Report-${stamp}.pdf`, content: buffer }] : undefined
  );

  await logActivity(req, {
    action: "report.emailed",
    entityType: "Report",
    entityId: report.id,
    label: address,
    summary: `emailed the signed inspection report to the customer (${to})`,
    links: { inspectionId, customerId: inspection.customerId, propertyId: inspection.propertyId },
  });
}

// `force` is the manual "Email to customer" button: it sends again even though
// the automatic email already went out (but not twice within a minute).
export async function maybeEmailReportToCustomer(req: Request, inspectionId: string, opts: { force?: boolean } = {}): Promise<CustomerEmailOutcome> {
  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, deletedAt: null },
    select: { id: true, status: true, customerId: true, technicianId: true, reportEmailedAt: true, signatures: { select: { signerType: true } } },
  });
  if (!inspection) return { sent: false, reason: "not_ready" };
  const signed = new Set(inspection.signatures.map((s) => s.signerType));
  if (inspection.status !== "COMPLETED" || !signed.has("CUSTOMER") || !signed.has("TECHNICIAN")) return { sent: false, reason: "not_ready" };
  if (inspection.reportEmailedAt && !opts.force) return { sent: false, reason: "already_sent" };
  if (inspection.reportEmailedAt && Date.now() - inspection.reportEmailedAt.getTime() < RESEND_COOLDOWN_MS) return { sent: false, reason: "too_soon" };

  const to = await customerAddress(inspection.customerId);
  if (!to) return { sent: false, reason: "no_email" };
  if (!emailAvailable()) return { sent: false, reason: "not_configured" };

  // Claim it before the slow part (building the PDF) so two requests arriving
  // together send one email. Putting the old value back if sending fails lets
  // the next signature / sync / button press try again.
  const previous = inspection.reportEmailedAt;
  const claimed = await prisma.inspection.updateMany({
    where: { id: inspection.id, reportEmailedAt: previous },
    data: { reportEmailedAt: new Date(), reportEmailedTo: to },
  });
  if (claimed.count === 0) return { sent: false, reason: "already_sent" };

  try {
    await deliver(req, inspection.id, to, inspection.technicianId);
    return { sent: true, to };
  } catch (err) {
    await prisma.inspection.updateMany({ where: { id: inspection.id }, data: { reportEmailedAt: previous } });
    // eslint-disable-next-line no-console
    console.error("Customer report email failed", inspection.id, err instanceof Error ? err.message : err);
    return { sent: false, reason: "failed" };
  }
}

// Fire-and-forget wrapper for the automatic triggers: the response to the
// device must not wait for a PDF to be built, and an error here must never
// surface as a failed signature upload.
export function emailReportInBackground(req: Request, inspectionId: string): void {
  maybeEmailReportToCustomer(req, inspectionId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Customer report email crashed", inspectionId, err instanceof Error ? err.message : err);
  });
}
