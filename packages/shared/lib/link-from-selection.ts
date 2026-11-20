/**
 * The address a selection of words already is, for a link box to start on.
 *
 * Select "example.com" and ask for a link, and the box opens on
 * "https://example.com". Shared by Mail's editor (RichTextEditor) and by a
 * notes editor in another app, so both guess the same way.
 */

/**
 * Already says how to reach it.
 *
 * `://` is required rather than a bare colon, because a scheme may contain
 * dots and `example.com:8443/path` is therefore a legal-looking one — it is
 * a host and a port, and treating it as a scheme left it without https.
 * `mailto:` and `tel:` are named, being the two that carry no authority.
 */
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

/**
 * `example.org`, `digitalhabits.org/demo`, `sub.example.co.uk/a?b=c`.
 *
 * Deliberately not the app's own link finder: that one only matches
 * addresses that already carry http:// or https://, because its job is to
 * find links inside a sentence, where a bare domain is too easy to imagine.
 * Here the writer has selected the text and asked for a link, so the guess
 * is invited — and it is only a guess: it fills the box, and they still
 * have to press Apply.
 */
const BARE_ADDRESS =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?::\d+)?(?:[/?#]\S*)?$/i;

/**
 * The address a selection is already offering, if it is offering one.
 *
 * Text like `digitalhabits.org/demo` is the address — retyping it with a
 * scheme on the front is work the writer has already done. The whole
 * selection has to be the link and nothing else, so a sentence that mentions
 * a domain still opens an empty box.
 */
export function urlFromSelection(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return "";
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  // An address is a person, not a site. Quill would link it as a relative
  // path, which goes nowhere.
  if (trimmed.includes("@")) return "";
  return BARE_ADDRESS.test(trimmed) ? `https://${trimmed}` : "";
}
