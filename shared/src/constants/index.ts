export const EVIDENCE_TYPE_OPTIONS = [
  "Droppings",
  "Gnaw marks",
  "Nesting material",
  "Live pest sighting",
  "Dead pest sighting",
  "Tracks/smudge marks",
  "Egg cases/casings",
  "Damage to structure/wiring",
  "Odor",
  "Webbing",
  "Grease marks",
] as const;

export const RISK_FACTOR_OPTIONS = [
  "Standing water",
  "Food source accessible",
  "Clutter/harborage",
  "Poor sanitation",
  "Vegetation contact with structure",
  "Cracks/gaps in foundation",
  "Improper waste storage",
  "Moisture/humidity issue",
  "Adjacent infested property",
] as const;

export const ENTRY_POINT_OPTIONS = [
  "Door gap",
  "Window gap",
  "Foundation crack",
  "Utility penetration",
  "Roofline/soffit gap",
  "Vent (unscreened)",
  "Pipe chase",
  "Weep hole",
  "Garage door seal",
] as const;

export const DEFAULT_PEST_TYPES: Array<{ name: string; category: string }> = [
  { name: "German Cockroach", category: "Cockroach" },
  { name: "American Cockroach", category: "Cockroach" },
  { name: "House Mouse", category: "Rodent" },
  { name: "Norway Rat", category: "Rodent" },
  { name: "Roof Rat", category: "Rodent" },
  { name: "Subterranean Termite", category: "Termite" },
  { name: "Drywood Termite", category: "Termite" },
  { name: "Bed Bug", category: "Bed Bug" },
  { name: "Carpenter Ant", category: "Ant" },
  { name: "Odorous House Ant", category: "Ant" },
  { name: "Pavement Ant", category: "Ant" },
  { name: "Wasp/Hornet", category: "Stinging Insect" },
  { name: "Spider (general)", category: "Spider" },
  { name: "Flea", category: "Flea/Tick" },
  { name: "Tick", category: "Flea/Tick" },
  { name: "Silverfish", category: "Occasional Invader" },
  { name: "Stored Product Pest", category: "Occasional Invader" },
];
