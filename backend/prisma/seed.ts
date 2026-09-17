import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { storage } from "../src/lib/storage";

const prisma = new PrismaClient();

// 1x1 transparent PNG, used as a stand-in signature image so the seeded
// demo inspection can actually reach COMPLETED status and generate a real
// PDF report - react-pdf needs a real image file on disk, not just a DB row.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@pestapp.dev" },
    update: {},
    create: {
      id: uuidv4(),
      email: "admin@pestapp.dev",
      passwordHash,
      firstName: "Ana",
      lastName: "Administrator",
      role: "ADMIN",
    },
  });

  const office = await prisma.user.upsert({
    where: { email: "office@pestapp.dev" },
    update: {},
    create: {
      id: uuidv4(),
      email: "office@pestapp.dev",
      passwordHash,
      firstName: "Oscar",
      lastName: "Office",
      role: "OFFICE",
    },
  });

  const tech = await prisma.user.upsert({
    where: { email: "tech@pestapp.dev" },
    update: {},
    create: {
      id: uuidv4(),
      email: "tech@pestapp.dev",
      passwordHash,
      firstName: "Tara",
      lastName: "Technician",
      role: "TECHNICIAN",
      phone: "555-0101",
    },
  });

  const existingCustomer = await prisma.customer.findFirst({ where: { name: "Jordan Miles" } });
  const customer =
    existingCustomer ??
    (await prisma.customer.create({
      data: {
        id: uuidv4(),
        type: "RESIDENTIAL",
        name: "Jordan Miles",
        email: "jordan.miles@example.com",
        phone: "555-0110",
        billingAddressLine1: "482 Maple Street",
        city: "Springfield",
        state: "IL",
        postalCode: "62704",
        country: "US",
      },
    }));

  await prisma.contact.upsert({
    where: { id: `${customer.id}-primary-contact` },
    update: {},
    create: {
      id: `${customer.id}-primary-contact`,
      customerId: customer.id,
      firstName: "Jordan",
      lastName: "Miles",
      role: "Homeowner",
      email: "jordan.miles@example.com",
      phone: "555-0110",
      isPrimary: true,
    },
  });

  const existingProperty = await prisma.property.findFirst({ where: { customerId: customer.id } });
  const property =
    existingProperty ??
    (await prisma.property.create({
      data: {
        id: uuidv4(),
        customerId: customer.id,
        label: "Main Residence",
        addressLine1: "482 Maple Street",
        city: "Springfield",
        state: "IL",
        postalCode: "62704",
        country: "US",
        lat: 39.7817,
        lng: -89.6501,
        propertyType: "RESIDENTIAL_SINGLE",
        squareFootage: 2100,
        yearBuilt: 1998,
        accessNotes: "Gate code 4821. Dog on property (friendly).",
      },
    }));

  const template =
    (await prisma.inspectionTemplate.findFirst({ where: { name: "General Residential Inspection" } })) ??
    (await prisma.inspectionTemplate.create({
      data: {
        id: uuidv4(),
        name: "General Residential Inspection",
        description: "Standard walkthrough covering exterior, interior, and crawlspace/attic.",
        pestCategory: "General",
        active: true,
      },
    }));

  // Simplified checklist structure (per Tate's feedback): each broad
  // inspection area is a single check with notes/photo captured on that
  // same item when something's found, instead of the old ~50-item-per-
  // category granular breakdown. Idempotent: re-running the seed fills in
  // anything missing rather than duplicating rows or wiping an already-
  // seeded dev database.
  const CHECKLIST_SECTIONS: Array<{
    name: string;
    category: "EXTERIOR" | "FIRST_FLOOR" | "SECOND_FLOOR" | "THIRD_FLOOR" | "BASEMENT" | "CRAWLSPACE" | "ATTIC" | "OTHER";
    sortOrder: number;
    items: Array<{ prompt: string; itemType: string; required: boolean }>;
  }> = [
    {
      name: "Foundation",
      category: "EXTERIOR",
      sortOrder: 0,
      items: [{ prompt: "Foundation in good condition (no cracks, gaps, or wood-to-soil contact)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Exterior structure",
      category: "EXTERIOR",
      sortOrder: 1,
      items: [{ prompt: "Exterior structure in good condition (siding, stucco/brick, wall penetrations sealed)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Entry points",
      category: "EXTERIOR",
      sortOrder: 2,
      items: [{ prompt: "No unsealed entry points found (utility lines, pipes, conduits, gaps around structure)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Property conditions",
      category: "EXTERIOR",
      sortOrder: 3,
      items: [{ prompt: "Property conditions satisfactory (vegetation trimmed, no debris/wood piles, drainage OK)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Doors/windows",
      category: "EXTERIOR",
      sortOrder: 4,
      items: [{ prompt: "Doors and windows sealed properly (sweeps, weatherstripping, screens intact)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Roofline/eaves",
      category: "EXTERIOR",
      sortOrder: 5,
      items: [{ prompt: "Roofline and eaves sealed (vents screened, no gaps at fascia or soffit)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Vents/openings",
      category: "EXTERIOR",
      sortOrder: 6,
      items: [{ prompt: "Vents and utility openings screened and sealed (dryer, attic, crawlspace, HVAC)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Garage",
      category: "EXTERIOR",
      sortOrder: 7,
      items: [{ prompt: "Garage sealed and pest-free (door seals, foundation vents, storage areas)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Kitchen & food storage",
      category: "FIRST_FLOOR",
      sortOrder: 0,
      items: [{ prompt: "Kitchen and food storage areas free of pest activity and entry points (under sink, appliances, pantry)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Bathrooms & utility rooms",
      category: "FIRST_FLOOR",
      sortOrder: 1,
      items: [{ prompt: "Bathrooms and utility/mechanical rooms free of pest activity and entry points", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Living areas",
      category: "FIRST_FLOOR",
      sortOrder: 2,
      items: [{ prompt: "Living areas free of pest activity (baseboards, wall voids, flooring, thresholds)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Living areas",
      category: "SECOND_FLOOR",
      sortOrder: 0,
      items: [{ prompt: "Second floor living areas free of pest activity (baseboards, wall voids, closets)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Bathrooms & utility rooms",
      category: "SECOND_FLOOR",
      sortOrder: 1,
      items: [{ prompt: "Second floor bathrooms and utility areas free of pest activity and moisture issues", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Entry points",
      category: "SECOND_FLOOR",
      sortOrder: 2,
      items: [{ prompt: "Second floor entry points sealed (window frames, utility penetrations, roofline access)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Living areas",
      category: "THIRD_FLOOR",
      sortOrder: 0,
      items: [{ prompt: "Third floor living areas free of pest activity (baseboards, wall voids, closets)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Entry points",
      category: "THIRD_FLOOR",
      sortOrder: 1,
      items: [{ prompt: "Third floor entry points sealed (window frames, roofline/eave access, utility penetrations)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Roofline access",
      category: "THIRD_FLOOR",
      sortOrder: 2,
      items: [{ prompt: "Third floor roofline/attic knee-wall access points sealed and pest-free", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Basement structure",
      category: "BASEMENT",
      sortOrder: 0,
      items: [{ prompt: "Basement walls and floor free of cracks, gaps, and wood-to-soil contact", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Moisture & drainage",
      category: "BASEMENT",
      sortOrder: 1,
      items: [{ prompt: "No standing water; sump pump (if present) functioning; moisture levels normal", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Pest evidence",
      category: "BASEMENT",
      sortOrder: 2,
      items: [{ prompt: "Basement free of visible pest activity (droppings, nesting, entry points)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Attic access",
      category: "ATTIC",
      sortOrder: 0,
      items: [{ prompt: "Attic access point sealed and pest-proof", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Insulation & structure",
      category: "ATTIC",
      sortOrder: 1,
      items: [{ prompt: "Insulation and roof structure free of nesting, damage, or gaps", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Vents/openings",
      category: "ATTIC",
      sortOrder: 2,
      items: [{ prompt: "Attic vents and openings screened and sealed", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Pest evidence",
      category: "ATTIC",
      sortOrder: 3,
      items: [{ prompt: "Attic free of visible pest activity (droppings, nesting, shed skins)", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Crawl space access",
      category: "CRAWLSPACE",
      sortOrder: 0,
      items: [{ prompt: "Crawl space access sealed and pest-proof", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Foundation & structure",
      category: "CRAWLSPACE",
      sortOrder: 1,
      items: [{ prompt: "Foundation, sill plate, and support piers free of cracks, gaps, and wood-to-soil contact", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Vents/openings",
      category: "CRAWLSPACE",
      sortOrder: 2,
      items: [{ prompt: "Crawl space vents screened and intact", itemType: "CHECKBOX", required: true }],
    },
    {
      name: "Moisture & pest evidence",
      category: "CRAWLSPACE",
      sortOrder: 3,
      items: [{ prompt: "No standing water or excess moisture; crawl space free of visible pest activity", itemType: "CHECKBOX", required: true }],
    },
  ];

  // Remove every managed-category section that isn't part of the simplified
  // structure above (this replaces both the old ~50-item breakdown and the
  // one-off legacy "Attic / Crawlspace" cleanup that used to live here) -
  // cascades to its items and any recorded checklist responses. Idempotent:
  // a no-op once a given seed run has already migrated a database.
  const keepSectionKeys = new Set(CHECKLIST_SECTIONS.map((s) => `${s.category}::${s.name}`));
  const managedCategories = ["EXTERIOR", "FIRST_FLOOR", "SECOND_FLOOR", "THIRD_FLOOR", "BASEMENT", "CRAWLSPACE", "ATTIC"] as const;
  // INTERIOR is retired (split into FIRST_FLOOR + BASEMENT below) but isn't
  // in managedCategories/CHECKLIST_SECTIONS any more, so it has to be
  // queried for explicitly here or its old sections would never be found
  // and cleaned up by the loop below.
  const legacyCategoriesToPurge = ["INTERIOR"] as const;
  const existingSections = await prisma.templateSection.findMany({
    where: { templateId: template.id, category: { in: [...managedCategories, ...legacyCategoriesToPurge] } },
  });
  for (const existing of existingSections) {
    if (keepSectionKeys.has(`${existing.category}::${existing.name}`)) continue;
    const staleItemIds = (
      await prisma.templateItem.findMany({ where: { sectionId: existing.id }, select: { id: true } })
    ).map((i) => i.id);
    await prisma.checklistResponse.deleteMany({ where: { templateItemId: { in: staleItemIds } } });
    await prisma.templateItem.deleteMany({ where: { sectionId: existing.id } });
    await prisma.templateSection.delete({ where: { id: existing.id } });
  }

  for (const s of CHECKLIST_SECTIONS) {
    // Matched by (template, name, category) - some section names (e.g.
    // "Garage", "Living areas", "Entry points") intentionally exist under
    // multiple categories as distinct sections, so name alone isn't a safe
    // match key.
    const section =
      (await prisma.templateSection.findFirst({ where: { templateId: template.id, name: s.name, category: s.category } })) ??
      (await prisma.templateSection.create({
        data: { id: uuidv4(), templateId: template.id, name: s.name, category: s.category, sortOrder: s.sortOrder },
      }));
    if (section.sortOrder !== s.sortOrder) {
      await prisma.templateSection.update({ where: { id: section.id }, data: { sortOrder: s.sortOrder } });
    }
    // A section that already existed under the old granular structure (e.g.
    // "Foundation", "Garage") may still carry its old multi-item breakdown -
    // drop whatever isn't in the new, single-item list for it.
    const keepPrompts = new Set(s.items.map((item) => item.prompt));
    const staleItems = await prisma.templateItem.findMany({ where: { sectionId: section.id, prompt: { notIn: [...keepPrompts] } } });
    if (staleItems.length > 0) {
      const staleIds = staleItems.map((i) => i.id);
      await prisma.checklistResponse.deleteMany({ where: { templateItemId: { in: staleIds } } });
      await prisma.templateItem.deleteMany({ where: { id: { in: staleIds } } });
    }
    for (const [index, item] of s.items.entries()) {
      const existingItem = await prisma.templateItem.findFirst({ where: { sectionId: section.id, prompt: item.prompt } });
      if (!existingItem) {
        await prisma.templateItem.create({
          data: { id: uuidv4(), sectionId: section.id, prompt: item.prompt, itemType: item.itemType, sortOrder: index, required: item.required },
        });
      }
    }
  }
  console.log(`Checklist template ready: ${template.name}`);

  // Give the property a structure sketch (grid + house outline + nameplate
  // labels, no photo needed) so the demo inspection's site map isn't blank.
  // Split into levels - Exterior plus a lighter Attic sketch - to show off
  // the per-level feature rather than a single flat drawing.
  const EXTERIOR_LEVEL_ID = "seed-level-exterior";
  const ATTIC_LEVEL_ID = "seed-level-attic";
  // Treat pre-levels sketch data (the flat { lines, labels } shape this
  // used before levels existed) as missing too, so an earlier deploy's seed
  // run gets migrated instead of staying stuck in the old format forever.
  const existingSketch = property.siteMapSketch ? JSON.parse(property.siteMapSketch) : null;
  if (!existingSketch || !Array.isArray(existingSketch.levels)) {
    await prisma.property.update({
      where: { id: property.id },
      data: {
        siteMapSketch: JSON.stringify({
          levels: [
            {
              id: EXTERIOR_LEVEL_ID,
              name: "Exterior",
              sortOrder: 0,
              lines: [
                { x1: 0.28, y1: 0.3, x2: 0.63, y2: 0.3 },
                { x1: 0.63, y1: 0.3, x2: 0.63, y2: 0.62 },
                { x1: 0.63, y1: 0.62, x2: 0.44, y2: 0.62 },
                { x1: 0.28, y1: 0.3, x2: 0.28, y2: 0.62 },
                { x1: 0.28, y1: 0.62, x2: 0.38, y2: 0.62 },
                { x1: 0.38, y1: 0.55, x2: 0.38, y2: 0.62 },
                { x1: 0.38, y1: 0.55, x2: 0.44, y2: 0.55 },
                { x1: 0.44, y1: 0.55, x2: 0.44, y2: 0.62 },
              ],
              labels: [
                { x: 0.52, y: 0.56, text: "Garage" },
                { x: 0.39, y: 0.57, text: "Porch" },
              ],
            },
            {
              id: ATTIC_LEVEL_ID,
              name: "Attic",
              sortOrder: 1,
              lines: [
                { x1: 0.3, y1: 0.35, x2: 0.6, y2: 0.35 },
                { x1: 0.6, y1: 0.35, x2: 0.6, y2: 0.6 },
                { x1: 0.6, y1: 0.6, x2: 0.3, y2: 0.6 },
                { x1: 0.3, y1: 0.6, x2: 0.3, y2: 0.35 },
              ],
              labels: [{ x: 0.38, y: 0.45, text: "Attic access" }],
            },
          ],
        }),
        siteMapUpdatedAt: new Date(),
      },
    });
  }

  // A fully realized example inspection so a fresh deploy shows working
  // findings/checklist/site-map/signatures out of the box instead of an
  // empty database - report and estimate are left for the viewer to
  // generate themselves (one click each) as a live demo of those features.
  const existingDemoInspection = await prisma.inspection.findFirst({
    where: { propertyId: property.id, generalNotes: { contains: "Seeded demo inspection" } },
  });
  let demoInspectionId: string | null = existingDemoInspection?.id ?? null;
  if (!existingDemoInspection) {
    const now = new Date();
    const inspection = await prisma.inspection.create({
      data: {
        id: uuidv4(),
        propertyId: property.id,
        customerId: customer.id,
        templateId: template.id,
        technicianId: tech.id,
        status: "COMPLETED",
        startedAt: now,
        completedAt: now,
        generalNotes: "Seeded demo inspection - quarterly general pest service.",
        weatherConditions: "Clear, 72F",
      },
    });

    const kitchenFinding = await prisma.finding.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        areaLocation: "Kitchen - under sink",
        severity: "HIGH",
        description:
          "Active German cockroach activity under kitchen sink - droppings and a live sighting observed. Moisture present from a slow leak, likely the entry/risk factor. Recommend sealing pipe chase and addressing the leak.",
      },
    });

    await prisma.finding.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        areaLocation: "Garage foundation vent",
        severity: "MEDIUM",
        description:
          "Gnaw marks consistent with mouse activity near the garage foundation vent. Gap around the vent screen is a likely rodent entry point - recommend screening it.",
        floorPlanX: 0.63,
        floorPlanY: 0.5,
        siteMapArrowStartX: 0.8,
        siteMapArrowStartY: 0.42,
        siteMapLevel: EXTERIOR_LEVEL_ID,
      },
    });

    await prisma.recommendation.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        findingId: kitchenFinding.id,
        title: "Fix under-sink leak",
        description: "Repair slow leak to remove moisture source attracting roaches.",
        priority: "HIGH",
        ownerType: "CUSTOMER",
        deadline: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        status: "OPEN",
      },
    });

    for (const signer of [
      { type: "CUSTOMER", name: customer.name },
      { type: "TECHNICIAN", name: `${tech.firstName} ${tech.lastName}` },
    ] as const) {
      const sigId = uuidv4();
      const key = `signatures/${inspection.id}/${sigId}.png`;
      await storage.save(PLACEHOLDER_PNG, key);
      await prisma.signature.create({
        data: {
          id: sigId,
          inspectionId: inspection.id,
          signerType: signer.type,
          signerName: signer.name,
          imageUrl: `/api/media/file/${key}`,
          signedAt: now,
        },
      });
    }

    await prisma.followUp.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        reason: "Verify roach activity resolved after leak repair",
        scheduledDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        correctiveActionStatus: "PENDING",
        status: "SCHEDULED",
      },
    });

    demoInspectionId = inspection.id;
    console.log(`Seeded demo inspection: ${inspection.id}`);
  }

  // Runs whether the demo inspection is brand new or already existed - the
  // checklist-simplification migration above deletes checklist responses
  // tied to retired template items, so an already-seeded database also
  // needs these two demo responses re-attached to their new item ids.
  if (demoInspectionId) {
    const sections = await prisma.templateSection.findMany({ where: { templateId: template.id }, include: { items: true } });
    const sinkItem = sections
      .flatMap((s) => s.items)
      .find((i) => i.prompt === "Kitchen and food storage areas free of pest activity and entry points (under sink, appliances, pantry)");
    const foundationItem = sections
      .flatMap((s) => s.items)
      .find((i) => i.prompt === "Foundation in good condition (no cracks, gaps, or wood-to-soil contact)");
    if (sinkItem) {
      const existingResponse = await prisma.checklistResponse.findFirst({ where: { inspectionId: demoInspectionId, templateItemId: sinkItem.id } });
      if (!existingResponse) {
        await prisma.checklistResponse.create({
          data: { id: uuidv4(), inspectionId: demoInspectionId, templateItemId: sinkItem.id, status: "NEEDS_ATTENTION", notes: "Droppings observed under sink" },
        });
      }
    }
    if (foundationItem) {
      const existingResponse = await prisma.checklistResponse.findFirst({ where: { inspectionId: demoInspectionId, templateItemId: foundationItem.id } });
      if (!existingResponse) {
        await prisma.checklistResponse.create({
          data: { id: uuidv4(), inspectionId: demoInspectionId, templateItemId: foundationItem.id, status: "SATISFACTORY", notes: null },
        });
      }
    }
  }

  console.log("Seed complete.");
  console.log(`  Admin login:      admin@pestapp.dev / password123`);
  console.log(`  Office login:     office@pestapp.dev / password123`);
  console.log(`  Technician login: tech@pestapp.dev / password123 (id: ${tech.id})`);
  console.log(`  Sample customer:  ${customer.name} (id: ${customer.id})`);
  console.log(`  Sample property:  ${property.label} (id: ${property.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
