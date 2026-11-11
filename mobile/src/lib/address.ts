export interface ParsedAddress {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

export const ADDRESS_LABEL = "Street address, city, state, ZIP code";
export const ADDRESS_PLACEHOLDER = "123 Main Street, Carmel, IN 46032";
export const ADDRESS_FORMAT_ERROR = "Enter the address as: 123 Main Street, City, ST 12345";

const ZIP = /^\d{4,5}(?:-\d{4})?$/;

const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP".split(" ")
);

// Splits one line like "123 Main Street, Carmel, IN 46032" into the
// separate street / city / state / ZIP the records store. Commas separate
// street from city from "state ZIP"; anything before the city stays in the
// street line (so "123 Main St, Apt 4, Carmel, IN 46032" keeps the apartment).
// Longer state names ("Misamis Oriental 9000") work too. Returns null when
// it can't tell which part is which.
export function parseSingleLineAddress(input: string): ParsedAddress | null {
  // Typed without commas ("14879 War Emblem Dr Noblesville IN 46060")?
  if (!input.includes(",")) return parseWithoutCommas(input);
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];
  let rest = parts.slice(0, -1);
  let state: string;
  let postalCode: string;

  const stateZip = /^(.*\S)\s+(\d{4,5}(?:-\d{4})?)$/.exec(last);
  if (stateZip) {
    state = stateZip[1];
    postalCode = stateZip[2];
    // "123 Main St, Carmel IN 46032" - no comma between city and state. Only
    // split on a real US state code, so a longer state name like "Misamis
    // Oriental" is left whole.
    const cityState = /^(.+?)\s+([A-Za-z]{2})$/.exec(state);
    if (cityState && US_STATE_CODES.has(cityState[2].toUpperCase())) {
      rest = [...rest, cityState[1]];
      state = cityState[2];
    }
  } else if (ZIP.test(last) && rest.length >= 3) {
    // "123 Main St, Carmel, IN, 46032"
    postalCode = last;
    state = rest[rest.length - 1];
    rest = rest.slice(0, -1);
  } else {
    return null;
  }

  // "14879 War Emblem Dr. Noblesville, IN 46060": street and city typed together.
  if (rest.length === 1) {
    const split = splitStreetAndCity(rest[0]);
    if (!split) return null;
    rest = [split.street, split.city];
  }
  if (rest.length < 2) return null;
  const city = rest[rest.length - 1];
  const addressLine1 = rest.slice(0, -1).join(", ");
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(state) || state.length < 2) return null;

  return {
    addressLine1,
    city,
    state: state.length === 2 ? state.toUpperCase() : state,
    postalCode,
  };
}

// The reverse of parseSingleLineAddress: "123 Main Street, Carmel, IN 46032".
// Null unless every part is present - a half-filled address would just fail
// to parse again in the form it's meant to prefill.
export function formatSingleLineAddress(parts: {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string | null {
  const street = parts.addressLine1?.trim();
  const city = parts.city?.trim();
  const state = parts.state?.trim();
  const zip = parts.postalCode?.trim();
  if (!street || !city || !state || !zip) return null;
  return `${street}, ${city}, ${state} ${zip}`;
}

// Words that end a street name. Only used to find where the street stops and
// the city starts when an address was typed without any commas.
const STREET_SUFFIXES = new Set(
  "st street ave avenue av rd road dr drive ln lane blvd boulevard ct court cir circle way pl place trl trail pkwy parkway ter terrace hwy highway sq square loop run pass xing crossing".split(" ")
);

// "14879 War Emblem Dr Noblesville IN 46060" -> street / city / state / ZIP.
// Needs a real US state code and ZIP at the end, and a street word (Dr, Ln, St,
// ...) with a city after it; anything it can't place with confidence is left
// for the person to put commas in (the form shows how it will be saved).
function parseWithoutCommas(input: string): ParsedAddress | null {
  const m = /^(.*\S)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(input.trim().replace(/\s+/g, " "));
  if (!m || !US_STATE_CODES.has(m[2].toUpperCase())) return null;
  const split = splitStreetAndCity(m[1]);
  return split ? { addressLine1: split.street, city: split.city, state: m[2].toUpperCase(), postalCode: m[3] } : null;
}

// "14879 War Emblem Dr Noblesville" -> street "14879 War Emblem Dr", city "Noblesville":
// split after the last street word that still leaves a city (1-4 words) after it.
function splitStreetAndCity(text: string): { street: string; city: string } | null {
  const tokens = text.trim().replace(/\s+/g, " ").split(" ");
  for (let i = tokens.length - 2; i >= 1; i--) {
    if (tokens.length - 1 - i > 4) break;
    if (STREET_SUFFIXES.has(tokens[i].replace(/\.$/, "").toLowerCase())) return { street: tokens.slice(0, i + 1).join(" "), city: tokens.slice(i + 1).join(" ") };
  }
  return null;
}

// What to tell someone whose address didn't parse: their own street, with the
// missing pieces spelled out, rather than a generic example.
export function addressHelp(input: string): string {
  const street = input.split(",")[0].trim();
  return street ? `Add the city, state and ZIP: ${street}, City, ST 12345` : ADDRESS_FORMAT_ERROR;
}
