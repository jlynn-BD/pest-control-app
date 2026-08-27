import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { DEFAULT_PEST_TYPES } from "@pest-app/shared";
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

  for (const pt of DEFAULT_PEST_TYPES) {
    await prisma.pestType.upsert({
      where: { name: pt.name },
      update: {},
      create: { id: uuidv4(), name: pt.name, category: pt.category },
    });
  }

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

  // Exterior/interior checklists, expressed as categorized template sections
  // so the same schema drives both the mobile checklist screen and the PDF
  // report. Idempotent: re-running the seed fills in anything missing
  // rather than duplicating rows or wiping an already-seeded dev database.
  const CHECKLIST_SECTIONS: Array<{
    name: string;
    category: "EXTERIOR" | "INTERIOR" | "OTHER";
    sortOrder: number;
    items: Array<{ prompt: string; itemType: string; required: boolean }>;
  }> = [
    {
      name: "Exterior Perimeter",
      category: "EXTERIOR",
      sortOrder: 0,
      items: [
        { prompt: "Check foundation for cracks/gaps", itemType: "CHECKBOX", required: true },
        { prompt: "Inspect vegetation contact with structure", itemType: "CHECKBOX", required: false },
        { prompt: "Check weep holes and utility line entry points", itemType: "CHECKBOX", required: true },
        { prompt: "Inspect roofline, eaves, and soffits", itemType: "CHECKBOX", required: false },
        { prompt: "Check for wood-to-ground contact", itemType: "CHECKBOX", required: false },
        { prompt: "Inspect doors and windows for gaps/weatherstripping", itemType: "CHECKBOX", required: true },
        { prompt: "Check drainage and standing water sources", itemType: "CHECKBOX", required: false },
        { prompt: "Photo of exterior overview", itemType: "PHOTO", required: false },
      ],
    },
    {
      name: "Foundation",
      category: "EXTERIOR",
      sortOrder: 1,
      items: [
        { prompt: "Foundation walls free of cracks, gaps, or holes", itemType: "CHECKBOX", required: true },
        { prompt: "Weep screed gap sealed / free of debris buildup", itemType: "CHECKBOX", required: true },
        { prompt: "No gap at slab-to-wall transition", itemType: "CHECKBOX", required: false },
        { prompt: "Foundation vents screened and intact", itemType: "CHECKBOX", required: true },
        { prompt: "No wood-to-soil contact at foundation", itemType: "CHECKBOX", required: false },
      ],
    },
    {
      name: "Exterior Structure",
      category: "EXTERIOR",
      sortOrder: 2,
      items: [
        { prompt: "Siding intact, no gaps or damage", itemType: "CHECKBOX", required: true },
        { prompt: "Stucco/brick veneer free of cracks and gaps", itemType: "CHECKBOX", required: false },
        { prompt: "No gaps between trim and siding", itemType: "CHECKBOX", required: false },
        { prompt: "Expansion joints sealed", itemType: "CHECKBOX", required: false },
        { prompt: "Exterior wall penetrations (pipes, wires, conduit) sealed", itemType: "CHECKBOX", required: true },
      ],
    },
    {
      name: "Entry Points",
      category: "EXTERIOR",
      sortOrder: 3,
      items: [
        { prompt: "Utility line entry points sealed (electrical, cable, gas)", itemType: "CHECKBOX", required: true },
        { prompt: "Pipe chases and conduits sealed", itemType: "CHECKBOX", required: true },
        { prompt: "No visible rodent gnaw marks at potential entry points", itemType: "CHECKBOX", required: false },
        { prompt: "Gaps around spigots/hose bibs sealed", itemType: "CHECKBOX", required: false },
        { prompt: "No gaps larger than 1/4 inch anywhere around the structure", itemType: "CHECKBOX", required: true },
        { prompt: "Record any entry point findings", itemType: "PEST_FINDING", required: false },
      ],
    },
    {
      name: "Doors & Windows",
      category: "EXTERIOR",
      sortOrder: 4,
      items: [
        { prompt: "Door sweeps intact and functional on all exterior doors", itemType: "CHECKBOX", required: true },
        { prompt: "Weatherstripping intact on all doors", itemType: "CHECKBOX", required: false },
        { prompt: "Window screens intact, no tears or gaps", itemType: "CHECKBOX", required: false },
        { prompt: "Window frames sealed, no gaps", itemType: "CHECKBOX", required: false },
        { prompt: "Garage man door sealed at threshold and side jambs", itemType: "CHECKBOX", required: true },
      ],
    },
    {
      name: "Roofline & Eaves",
      category: "EXTERIOR",
      sortOrder: 5,
      items: [
        { prompt: "Roof vents/jacks screened", itemType: "CHECKBOX", required: true },
        { prompt: "No gaps at fascia or soffit", itemType: "CHECKBOX", required: true },
        { prompt: "Eaves free of gaps between roof and wall", itemType: "CHECKBOX", required: false },
        { prompt: "Roof-to-wall (rafter tail) gaps sealed", itemType: "CHECKBOX", required: false },
        { prompt: "Roof pocket / valley areas checked and sealed", itemType: "CHECKBOX", required: false },
        { prompt: "Gutters clear of debris", itemType: "CHECKBOX", required: false },
      ],
    },
    {
      name: "Vents & Utility Openings",
      category: "EXTERIOR",
      sortOrder: 6,
      items: [
        { prompt: "Dryer vent screened / capped", itemType: "CHECKBOX", required: true },
        { prompt: "Attic vents screened", itemType: "CHECKBOX", required: true },
        { prompt: "Crawlspace vents screened and intact", itemType: "CHECKBOX", required: false },
        { prompt: "HVAC line set penetration sealed", itemType: "CHECKBOX", required: false },
        { prompt: "AC line / refrigerant line gap sealed", itemType: "CHECKBOX", required: true },
      ],
    },
    {
      name: "Attached Structures",
      category: "EXTERIOR",
      sortOrder: 7,
      items: [
        { prompt: "Garage foundation vents checked", itemType: "CHECKBOX", required: false },
        { prompt: "Garage man door gaps sealed", itemType: "CHECKBOX", required: false },
        { prompt: "Garage overhead door seals intact", itemType: "CHECKBOX", required: true },
        { prompt: "Porch/deck substructure free of pest harborage", itemType: "CHECKBOX", required: false },
        { prompt: "Attached storage areas checked", itemType: "CHECKBOX", required: false },
      ],
    },
    {
      name: "Property Conditions",
      category: "EXTERIOR",
      sortOrder: 8,
      items: [
        { prompt: "Vegetation trimmed back from structure (12+ inches)", itemType: "CHECKBOX", required: false },
        { prompt: "No wood piles or debris stacked against structure", itemType: "CHECKBOX", required: true },
        { prompt: "Standing water / drainage issues addressed", itemType: "CHECKBOX", required: false },
        { prompt: "Trash/recycling bins stored away from structure", itemType: "CHECKBOX", required: false },
        { prompt: "Mulch not in direct contact with siding", itemType: "CHECKBOX", required: false },
      ],
    },
    {
      name: "Interior - Kitchen & Pantry",
      category: "INTERIOR",
      sortOrder: 1,
      items: [
        { prompt: "Check under sink and appliances", itemType: "CHECKBOX", required: true },
        { prompt: "Inspect pantry and food storage areas", itemType: "CHECKBOX", required: true },
        { prompt: "Record pest evidence found", itemType: "PEST_FINDING", required: false },
      ],
    },
    {
      name: "Interior - Bathrooms & Utility",
      category: "INTERIOR",
      sortOrder: 2,
      items: [
        { prompt: "Check under bathroom sinks and around tile grout", itemType: "CHECKBOX", required: true },
        { prompt: "Inspect utility/mechanical room", itemType: "CHECKBOX", required: false },
        { prompt: "Check baseboards and visible wall voids", itemType: "CHECKBOX", required: false },
      ],
    },
    {
      name: "Attic / Crawlspace",
      category: "INTERIOR",
      sortOrder: 3,
      items: [
        { prompt: "Check insulation for nesting/droppings", itemType: "CHECKBOX", required: true },
        { prompt: "Note moisture level", itemType: "TEXT", required: false },
      ],
    },
  ];

  for (const s of CHECKLIST_SECTIONS) {
    const section =
      (await prisma.templateSection.findFirst({ where: { templateId: template.id, name: s.name } })) ??
      (await prisma.templateSection.create({
        data: { id: uuidv4(), templateId: template.id, name: s.name, category: s.category, sortOrder: s.sortOrder },
      }));
    if (section.category !== s.category || section.sortOrder !== s.sortOrder) {
      await prisma.templateSection.update({ where: { id: section.id }, data: { category: s.category, sortOrder: s.sortOrder } });
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
  // findings/checklist/site-map/treatment/signatures out of the box instead
  // of an empty database - report and estimate are left for the viewer to
  // generate themselves (one click each) as a live demo of those features.
  const existingDemoInspection = await prisma.inspection.findFirst({
    where: { propertyId: property.id, generalNotes: { contains: "Seeded demo inspection" } },
  });
  if (!existingDemoInspection) {
    const roach = await prisma.pestType.findUnique({ where: { name: "German Cockroach" } });
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
        pestTypeId: roach?.id ?? null,
        areaLocation: "Kitchen - under sink",
        evidenceTypes: JSON.stringify(["Droppings", "Live pest sighting"]),
        severity: "HIGH",
        riskFactors: JSON.stringify(["Moisture/humidity issue"]),
        entryPoints: JSON.stringify(["Pipe chase"]),
        description: "Active roach activity under kitchen sink, moisture present from a slow leak.",
      },
    });

    await prisma.finding.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        pestTypeOther: "Mouse",
        areaLocation: "Garage foundation vent",
        evidenceTypes: JSON.stringify(["Gnaw marks"]),
        severity: "MEDIUM",
        riskFactors: JSON.stringify([]),
        entryPoints: JSON.stringify(["Foundation vent"]),
        description: "Gap around garage foundation vent screen; possible rodent entry point.",
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

    const treatment = await prisma.treatmentRecord.create({
      data: {
        id: uuidv4(),
        inspectionId: inspection.id,
        findingId: kitchenFinding.id,
        technicianId: tech.id,
        method: "Gel bait application",
        targetPest: "German Cockroach",
        areaTreated: "Kitchen cabinets and under sink",
        appliedAt: now,
        safetyInstructions: "Keep pets away from treated area for 2 hours.",
        approvalStatus: "APPROVED",
        approvedAt: now,
      },
    });
    await prisma.treatmentProduct.create({
      data: {
        id: uuidv4(),
        treatmentRecordId: treatment.id,
        productName: "Advion Cockroach Gel Bait",
        epaRegistrationNumber: "100-1484",
        activeIngredient: "Indoxacarb 0.6%",
        quantity: 5,
        unit: "g",
        applicationMethod: "Spot application",
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

    const sections = await prisma.templateSection.findMany({ where: { templateId: template.id }, include: { items: true } });
    const sinkItem = sections.flatMap((s) => s.items).find((i) => i.prompt === "Check under sink and appliances");
    const foundationItem = sections.flatMap((s) => s.items).find((i) => i.prompt === "Check foundation for cracks/gaps");
    if (sinkItem) {
      await prisma.checklistResponse.create({
        data: { id: uuidv4(), inspectionId: inspection.id, templateItemId: sinkItem.id, status: "NEEDS_ATTENTION", notes: "Droppings observed under sink" },
      });
    }
    if (foundationItem) {
      await prisma.checklistResponse.create({
        data: { id: uuidv4(), inspectionId: inspection.id, templateItemId: foundationItem.id, status: "SATISFACTORY", notes: null },
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

    console.log(`Seeded demo inspection: ${inspection.id}`);
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
