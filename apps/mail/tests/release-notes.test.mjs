/**
 * A release's notes as the update bar's What's new shows them
 * (lib/mail/release-notes.ts). The notes are invented.
 */

import { hasReleaseNotes, parseReleaseNotes } from "@/lib/mail/release-notes";

import { check, suite } from "./harness.mjs";

const NOTES = `## What is new

**Send later**
- **Send later works for every mailbox,** as it does for Outlook.
- **Quit asks first** when a message is waiting.

**Other**
- The count sits level with its label.
- **Stacks switch** — turn stacking on and off from the toolbar.
`;

suite(async () => {
  const notes = parseReleaseNotes(NOTES);
  check("four changes, the heading left out", notes.length === 4, JSON.stringify(notes));
  check(
    "a bold start is the name, without its comma",
    notes[0].title === "Send later works for every mailbox" && notes[0].detail === "As it does for Outlook.",
    JSON.stringify(notes[0])
  );
  check("a name with words after it", notes[1].title === "Quit asks first" && notes[1].detail === "When a message is waiting.");
  check("the bold line alone is the group", notes[0].group === "Send later" && notes[2].group === "Other");
  check("a line with no name keeps its words", notes[2].title === "" && notes[2].detail === "The count sits level with its label.");
  check("a dash after the name goes", notes[3].detail === "Turn stacking on and off from the toolbar.", notes[3].detail);

  check("the script's stand-in is not notes", !hasReleaseNotes("Version 0.11.27") && !hasReleaseNotes(null) && hasReleaseNotes(NOTES));
});
