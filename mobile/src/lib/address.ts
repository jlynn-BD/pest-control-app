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
