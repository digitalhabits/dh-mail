/**
 * A sender's signature, shown once a thread.
 *
 * The first message from a person in a thread shows their signature. Each
 * later one from them puts it behind the "…" fold with the quoted history:
 * the name, the title and the logo said once are enough.
 *
 * A signature is found by what repeats, not by guessing what one looks like:
 * the tail of this message that the same sender's earlier message in the
 * thread ends with too (two lines or blocks at least, so one repeated
 * "Thanks!" is not taken for a signature). Beside that, the marks a mail
 * client leaves: a "-- " line, and the signature boxes of Gmail, Outlook and
 * Thunderbird. Only ever for a later message from the same sender; a first
 * message is never touched, and nothing is cut that would leave it empty.
 */

/** What is compared: one line of text, or the text of one block of HTML. */
type Segments = string[];

/** The fewest closing lines or blocks that count as a signature. */
const MIN_REPEATED = 2;

const SIGNATURE_SELECTORS = [
  ".gmail_signature",
  "[data-smartmail='gmail_signature']",
  "#Signature",
  "#signature",
  ".moz-signature",
];

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TABLE", "TR", "UL", "OL",
]);

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** "-- " (or "--") on a line of its own: where a signature starts by the rules. */
function isDelimiter(line: string): boolean {
  return /^--\s*$/.test(line);
}

/** The lines of a text, blank ones left out, as compared. */
export function textSegments(text: string): Segments {
  return text.split(/\r?\n/).map(normalise).filter(Boolean);
}

/** How many closing segments of `mine` the earlier message ends with too. */
function sharedTail(mine: Segments, earlier: Segments): number {
  let n = 0;
  while (n < mine.length && n < earlier.length && mine[mine.length - 1 - n] === earlier[earlier.length - 1 - n]) n++;
  return n;
}

/**
 * A later plain-text message with the signature taken off, or the text as it
 * was when there is none to take or nothing would be left.
 */
export function stripRepeatedSignatureText(text: string, earlier: Segments): string {
  const lines = text.split(/\r?\n/);
  // The "-- " line: everything from it is the signature.
  const delimiter = lines.findIndex(isDelimiter);
  let cut = delimiter > 0 ? delimiter : -1;
  if (cut < 0) {
    const mine = textSegments(text);
    const shared = sharedTail(mine, earlier);
    if (shared >= MIN_REPEATED && shared < mine.length) {
      // The line where the shared tail starts, counting non-blank lines from the end.
      let left = shared;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!normalise(lines[i])) continue;
        left--;
        if (left === 0) {
          cut = i;
          break;
        }
      }
    }
  }
  if (cut < 0) return text;
  const kept = lines.slice(0, cut).join("\n").trim();
  return kept ? kept : text;
}

/** Block elements with no block inside them, in document order: the "lines" of an HTML message. */
function leafBlocks(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    const children = Array.from(el.children);
    const hasBlockChild = children.some((c) => BLOCK_TAGS.has(c.tagName));
    if (BLOCK_TAGS.has(el.tagName) && !hasBlockChild) {
      out.push(el);
      return;
    }
    children.forEach(walk);
  };
  walk(root);
  return out;
}

/** The text blocks of an HTML message, empty ones left out, as compared. */
export function htmlSegments(html: string): Segments {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.body) return [];
  return leafBlocks(doc.body)
    .map((el) => normalise(el.textContent ?? ""))
    .filter(Boolean);
}

/** Remove `from` and everything after it in the document. */
function cutFrom(doc: Document, from: Element): void {
  let node: Node | null = from;
  while (node && node !== doc.body) {
    while (node.nextSibling) node.nextSibling.remove();
    node = node.parentNode;
  }
  from.remove();
}

/**
 * A later HTML message with the signature taken off. `changed` says whether
 * anything was; when it was not, or nothing would be left, the HTML is
 * handed back as it came.
 */
export function stripRepeatedSignatureHtml(html: string, earlier: Segments): { html: string; changed: boolean } {
  if (typeof DOMParser === "undefined") return { html, changed: false };
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.body) return { html, changed: false };

  // A signature box a mail client marked as one: the first in the message.
  let start: Element | null = doc.body.querySelector(SIGNATURE_SELECTORS.join(", "));
  const blocks = leafBlocks(doc.body).filter((el) => normalise(el.textContent ?? ""));
  // A "-- " line.
  const delimiter = blocks.find((el) => isDelimiter((el.textContent ?? "").trim()));
  if (!start && delimiter) start = delimiter;
  // The tail the earlier message ends with too.
  if (!start) {
    const mine = blocks.map((el) => normalise(el.textContent ?? ""));
    const shared = sharedTail(mine, earlier);
    if (shared >= MIN_REPEATED && shared < mine.length) start = blocks[blocks.length - shared];
  }
  if (!start) return { html, changed: false };

  cutFrom(doc, start);
  // The blank lines that stood between the words and the signature.
  let last = doc.body.lastElementChild;
  while (last && !(last.textContent ?? "").trim() && !last.querySelector("img")) {
    const prev = last.previousElementSibling;
    last.remove();
    last = prev;
  }
  const left = (doc.body.textContent ?? "").trim();
  if (!left && !doc.body.querySelector("img")) return { html, changed: false };
  return { html: doc.body.innerHTML, changed: true };
}

/**
 * For each message, the one before it in the thread from the same sender.
 * A message with none (the sender's first) is not in the map.
 */
export function earlierFromSameSender<T extends { id: string; fromEmail: string }>(messages: T[]): Map<string, T> {
  const last = new Map<string, T>();
  const out = new Map<string, T>();
  for (const message of messages) {
    const key = message.fromEmail.trim().toLowerCase();
    if (!key) continue;
    const before = last.get(key);
    if (before) out.set(message.id, before);
    last.set(key, message);
  }
  return out;
}
