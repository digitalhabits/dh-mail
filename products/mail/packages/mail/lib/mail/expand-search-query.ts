/**
 * Gmail's search matches whole indexed tokens — "øjenhospital" misses
 * "Øjenhospitalet". Outlook does fuzzier stemming. For a single simple word,
 * OR in common Danish/English endings so stem queries still hit.
 *
 * Advanced Gmail syntax (operators, quotes, OR/AND) is left untouched.
 */

const HAS_OPERATOR_RE =
  /["{}():]|\bOR\b|\bAND\b|\bfrom:|\bto:|\bcc:|\bbcc:|\bsubject:|\bin:|\blabel:|\bis:|\bhas:|\bnewer_than:|\bolder_than:|\blarger:|\bsmaller:/i;

const SIMPLE_WORD_RE = /^[\p{L}\p{N}]+$/u;

const SUFFIXES = [
  // Danish definite / plural-ish
  "et",
  "en",
  "er",
  "e",
  "ens",
  "ets",
  "ene",
  // English
  "s",
  "es",
  "ed",
  "ing",
] as const;

function morphVariants(word: string): string[] {
  const variants = new Set<string>([word]);

  for (const suf of SUFFIXES) {
    variants.add(`${word}${suf}`);
    if (word.length - suf.length >= 4 && word.toLowerCase().endsWith(suf)) {
      variants.add(word.slice(0, -suf.length));
    }
  }

  // Danish consonant doubling before -en/-et (klinik → klinikken).
  const lower = word.toLowerCase();
  if (/[bcdfghjklmnpqrstvwxz]$/i.test(word) && word.length >= 4) {
    const doubled = `${word}${word.slice(-1)}`;
    variants.add(`${doubled}en`);
    variants.add(`${doubled}et`);
    if (lower.endsWith("en") || lower.endsWith("et")) {
      const stem = word.slice(0, -2);
      if (stem.length >= 4 && stem.slice(-1) === stem.slice(-2, -1)) {
        variants.add(stem.slice(0, -1));
      }
    }
  }

  return [...variants];
}

/** Expand a user search string for provider APIs (Gmail / Outlook). */
export function expandMailSearchQuery(q: string): string {
  const trimmed = q.trim();
  if (!trimmed || HAS_OPERATOR_RE.test(trimmed)) return trimmed;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length !== 1) return trimmed;

  const word = words[0];
  if (!SIMPLE_WORD_RE.test(word) || word.length < 4) return trimmed;

  const variants = morphVariants(word);
  if (variants.length <= 1) return trimmed;
  return variants.join(" OR ");
}

/** Wrap OR-expansions so they combine cleanly with folder/label constraints. */
export function parenthesizeSearchQuery(q: string): string {
  const trimmed = q.trim();
  if (!trimmed) return trimmed;
  if (/\bOR\b/i.test(trimmed) && !trimmed.startsWith("(")) {
    return `(${trimmed})`;
  }
  return trimmed;
}
