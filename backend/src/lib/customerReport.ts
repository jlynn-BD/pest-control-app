import type { Request } from "express";
import { prisma } from "./prisma";
import { EMAIL_HEADLINE_FONT, brandedEmail, emailAvailable, sendEmail } from "./email";
import { logActivity } from "./audit";
import { generateReportFor } from "../modules/reports/generate";
import { storage } from "./storage";

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

// ---- The Blue Duck copy ------------------------------------------------------
// Every finished inspection also goes to the technician who did it (the email
// they sign in with) and to Blue Duck's office (hello@trustblueduck.com, or
// whatever REPORT_COPY_TO says), so the company has the signed report, who did
// the work and who signed (and when) without relying on the technician or the
// customer to pass it on. Same trigger
// as the customer email (completed + both signatures) but independent of it:
// it is sent even when the customer has no email on file, and it says whether
// the customer's copy went out. It attaches the same stored PDF the customer
// received. Claimed on Inspection.companyCopiedAt so it goes once.

export type CompanyCopyOutcome =
  | { sent: true; to: string[] }
  | { sent: false; reason: "not_ready" | "not_configured" | "already_sent" | "failed" };

export const DEFAULT_OFFICE_COPY = "hello@trustblueduck.com";

// The office address(es) - REPORT_COPY_TO (comma separated) replaces the
// default - plus the technician's own login address when it is a real mailbox
// (demo/reserved addresses are skipped, like the customer's). No duplicates.
export function companyCopyAddresses(technicianEmail?: string | null): string[] {
  const office = (process.env.REPORT_COPY_TO?.trim() || DEFAULT_OFFICE_COPY).split(/[,;\s]+/).map((a) => a.trim());
  const all = [...(isRealCustomerEmail(technicianEmail) ? [technicianEmail.trim()] : []), ...office].filter((a) => EMAIL_RE.test(a));
  const seen = new Set<string>();
  return all.filter((a) => (seen.has(a.toLowerCase()) ? false : (seen.add(a.toLowerCase()), true)));
}

function companyTime(d: Date | null | undefined): string {
  if (!d) return "-";
  const timeZone = process.env.COMPANY_TIMEZONE || "America/Indiana/Indianapolis";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

export async function maybeEmailReportToCompany(req: Request, inspectionId: string): Promise<CompanyCopyOutcome> {
  if (!emailAvailable()) return { sent: false, reason: "not_configured" };

  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, deletedAt: null },
    include: {
      customer: true,
      property: true,
      technician: true,
      signatures: { orderBy: { signedAt: "asc" } },
      findings: { where: { deletedAt: null }, select: { severity: true } },
      sectionSkips: { select: { kind: true } },
      report: true,
    },
  });
  if (!inspection) return { sent: false, reason: "not_ready" };
  const to = companyCopyAddresses(inspection.technician.email);
  if (to.length === 0) return { sent: false, reason: "not_configured" };
  const latest = (type: string) => [...inspection.signatures].reverse().find((s) => s.signerType === type);
  const techSig = latest("TECHNICIAN");
  const custSig = latest("CUSTOMER");
  if (inspection.status !== "COMPLETED" || !techSig || !custSig) return { sent: false, reason: "not_ready" };
  if (inspection.companyCopiedAt) return { sent: false, reason: "already_sent" };

  // Claim first (same reason as the customer email), put it back on failure.
  const claimed = await prisma.inspection.updateMany({
    where: { id: inspection.id, companyCopiedAt: null },
    data: { companyCopiedAt: new Date(), companyCopiedTo: to.join(", ") },
  });
  if (claimed.count === 0) return { sent: false, reason: "already_sent" };

  try {
    // The exact PDF the customer got when there is one; otherwise build it now.
    let buffer: Buffer | null = null;
    if (inspection.report) {
      buffer = (await storage.read(`reports/${inspection.id}/report-v${inspection.report.version}.pdf`))?.data ?? null;
    }
    if (!buffer) buffer = (await generateReportFor(inspection.id, inspection.technicianId)).buffer;

    // Re-read what the customer email did (it ran just before this).
    const sent = await prisma.inspection.findUnique({ where: { id: inspection.id }, select: { reportEmailedAt: true, reportEmailedTo: true } });
    const address = `${inspection.property.addressLine1}, ${inspection.property.city}, ${inspection.property.state} ${inspection.property.postalCode}`;
    const tech = `${inspection.technician.firstName} ${inspection.technician.lastName}`;
    const attach = buffer.length <= MAX_ATTACHMENT_BYTES;
    const stamp = (inspection.completedAt ?? new Date()).toISOString().slice(0, 10);
    const bySeverity = ["HIGH", "MEDIUM", "LOW"].map((sev) => [sev, inspection.findings.filter((f) => f.severity === sev).length] as const).filter(([, n]) => n > 0);
    const findingsText = inspection.findings.length === 0 ? "none" : `${inspection.findings.length} (${bySeverity.map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ")})`;
    const notAccessible = inspection.sectionSkips.filter((k) => k.kind === "NOT_ACCESSIBLE").length;
    const customerLine = sent?.reportEmailedAt
      ? `Emailed to ${sent.reportEmailedTo} on ${companyTime(sent.reportEmailedAt)}`
      : "NOT emailed to the customer (no usable email address on file, or the send failed) - use Email to customer on the report screen once an address is on file";

    const rows: [string, string][] = [
      ["Property", address],
      ["Customer", inspection.customer.name],
      ["Technician", `${tech} (${inspection.technician.email})`],
      ["Started", companyTime(inspection.startedAt)],
      ["Property measured and mapped", inspection.measuredAt ? companyTime(inspection.measuredAt) : "-"],
      ["Completed", companyTime(inspection.completedAt)],
      ["Technician signed", `${techSig.signerName} - ${companyTime(techSig.signedAt)}`],
      ["Customer signed", `${custSig.signerName} - ${companyTime(custSig.signedAt)}`],
      ["Findings", findingsText],
      ["Areas not accessible", String(notAccessible)],
      ["Customer's copy", customerLine],
    ];
    const text =
      `A Blue Duck inspection was completed and signed.\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\n` +
      (attach ? `The signed report (the same PDF the customer receives) is attached.` : `The signed report is too large to attach - open the inspection in the app to download it.`);
    const html = brandedEmail(
      `<p style="font-family:${EMAIL_HEADLINE_FONT};font-size:18px;color:#002255;margin:0 0 16px">Inspection completed and signed</p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
        rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5A6B86;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join("") +
        `</table>` +
        `<p style="font-size:14px;margin-top:16px">${attach ? "The signed report (the same PDF the customer receives) is attached." : "The signed report is too large to attach - open the inspection in the app to download it."}</p>`
    );

    await sendEmail(
      to.join(", "),
      `Inspection completed - ${inspection.property.addressLine1} - ${tech}`,
      text,
      html,
      attach ? [{ filename: `Blue-Duck-Inspection-Report-${stamp}.pdf`, content: buffer }] : undefined
    );
    await logActivity(req, {
      action: "report.copied",
      entityType: "Report",
      entityId: inspection.report?.id ?? null,
      label: address,
      summary: "sent the Blue Duck office its copy of the signed inspection report",
      links: { inspectionId: inspection.id, customerId: inspection.customerId, propertyId: inspection.propertyId },
    });
    return { sent: true, to };
  } catch (err) {
    await prisma.inspection.updateMany({ where: { id: inspection.id }, data: { companyCopiedAt: null, companyCopiedTo: null } });
    // eslint-disable-next-line no-console
    console.error("Company report copy failed", inspection.id, err instanceof Error ? err.message : err);
    return { sent: false, reason: "failed" };
  }
}

// Fire-and-forget wrapper for the automatic triggers: the response to the
// device must not wait for a PDF to be built, and an error here must never
// surface as a failed signature upload.
export function emailReportInBackground(req: Request, inspectionId: string): void {
  (async () => {
    // Customer first: the office copy reports whether that one went out.
    try {
      await maybeEmailReportToCustomer(req, inspectionId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Customer report email crashed", inspectionId, err instanceof Error ? err.message : err);
    }
    try {
      await maybeEmailReportToCompany(req, inspectionId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Company report copy crashed", inspectionId, err instanceof Error ? err.message : err);
    }
  })();
}
