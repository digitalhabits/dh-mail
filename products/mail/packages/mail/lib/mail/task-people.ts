/**
 * How a person on the to-do board is drawn: the colour of their avatar, their
 * initials, and the short forms of their name.
 *
 * The same rules as To-Do's own (products/todo lib/todo/people.ts), so a
 * person proposed on a task in Update CRM wears the colour and initials they
 * wear on the board. The mail interface is built without the To-Do package,
 * so the rules are kept here as well. Change both together.
 *
 * No React here, so a test can run it directly.
 */

const AVATAR_COLOURS = [
  "#0d9488", // teal
  "#1e293b", // slate
  "#2563eb", // blue
  "#b45309", // amber
  "#7c3aed", // violet
  "#be123c", // rose
  "#0f766e", // dark teal
  "#334155", // gray
];

/** Titles that must not become the "first name" in short labels. */
const NAME_HONORIFICS = new Set([
  "dr",
  "dr.",
  "prof",
  "prof.",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
  "mx",
  "mx.",
  "sir",
  "rev",
  "rev.",
  "revd",
  "revd.",
]);

function nameParts(name: string): string[] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_HONORIFICS.has(parts[0].toLowerCase())) {
    parts.shift();
  }
  return parts;
}

/** "Dr Vera Holm" → "VH". */
export function initialsOf(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

/** "Anton Asmund" → "Anton A."; "Dr Vera Holm" → "Vera H." */
export function shortPersonName(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return name.trim();
  if (parts.length < 2) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0]?.toUpperCase() ?? ""}.`;
}

/** "Dr Vera Holm" → "Vera", as the assign chip lists them. */
export function firstName(name: string): string {
  return nameParts(name)[0] ?? name.trim();
}

/** The person's own colour when the board has one, else one kept for the name. */
export function colourForPerson(name: string, explicit?: string | null): string {
  if (explicit && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(explicit)) {
    return explicit;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}
