/**
 * A release's notes, as the update bar's What's new shows them: a change
 * a row, its name in bold and what it does under it.
 *
 * The notes are the Markdown a release is published with
 * (scripts/publish-team-update.mjs, or a GitHub release's text):
 *
 *     ## What is new
 *     **Send later for Gmail and Exchange**
 *     - **Send later now works for Gmail,** as it does for Outlook.
 *     - The Triage count sits level with its label.
 *
 * A bold line alone starts a group. A bullet that starts in bold is a
 * change with a name; any other bullet or line is a change without one.
 * Headings are left out: the pop-up has its own.
 *
 * No React here: this is the part a suite reads.
 */

export type ReleaseNote = {
  /** The bold line above it, when the notes are in groups. */
  group: string | null;
  /** The change's name, or "" for a line without one. */
  title: string;
  /** What it does. */
  detail: string;
};

/** Markdown marks a reader would see as stars and underscores. */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function parseReleaseNotes(markdown: string | null | undefined): ReleaseNote[] {
  const out: ReleaseNote[] = [];
  let group: string | null = null;
  for (const raw of (markdown ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const alone = /^\*\*(.+?)\*\*:?$/.exec(line);
    if (alone) {
      group = plain(alone[1]);
      continue;
    }
    const text = line.replace(/^[-*+]\s+/, "");
    const named = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text);
    if (named) {
      // "**Quit asks first** when …": the name, without the comma or full
      // stop that ended it inside the bold.
      const title = plain(named[1]).replace(/[,.:;]+$/, "");
      const detail = plain(named[2]).replace(/^[-–—:,]\s*/, "");
      out.push({ group, title, detail: detail ? detail[0].toUpperCase() + detail.slice(1) : "" });
    } else {
      out.push({ group, title: "", detail: plain(text) });
    }
  }
  return out;
}

/**
 * Whether the notes say anything: the publish script writes
 * "Version 0.11.27" when it is given none.
 */
export function hasReleaseNotes(markdown: string | null | undefined): boolean {
  const notes = parseReleaseNotes(markdown);
  return notes.length > 0 && !(notes.length === 1 && /^Version \S+$/.test(notes[0].detail));
}
