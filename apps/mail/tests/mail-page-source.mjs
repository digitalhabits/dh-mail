/**
 * MailPage and ThreadPane, each with the files it is split into, read as
 * one text.
 *
 * MailPage.tsx holds the page's markup, use-mail-page.tsx its logic, and
 * the mail-*.tsx files beside them the parts of the markup that moved out.
 * A suite that reads the page's source reads all of them, so a line can
 * move between them without the suite failing.
 *
 * From the working directory, not from this file: the harness compiles
 * each suite into a temp directory, so this file's own path leads nowhere.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "../../products/mail/packages/mail/components/mail");

export function mailPageSource() {
  const split = readdirSync(DIR)
    .filter((f) => /^mail-.*\.tsx$/.test(f))
    .sort();
  return ["MailPage.tsx", "use-mail-page.tsx", ...split]
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .join("\n");
}

/**
 * ThreadPane and the files it is split into, read as one text: the markup
 * in ThreadPane.tsx, the logic in use-thread-pane.tsx, and the parts of the
 * markup in thread-pane-*.tsx and thread-composer-*.tsx.
 */
export function threadPaneSource() {
  const split = readdirSync(DIR)
    .filter((f) => /^thread-(pane|composer)-.*\.tsx$/.test(f))
    .sort();
  // Hooks that came out of use-thread-pane.tsx after the split.
  const hooks = [
    "use-reply-content.ts",
    "use-thread-keys.ts",
    "use-thread-scheduled.ts",
    "use-composer-keys.ts",
  ];
  return ["ThreadPane.tsx", "use-thread-pane.tsx", ...hooks, ...split]
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .join("\n");
}


/**
 * The new-message composer, read as one text: the markup in
 * ComposeView.tsx and the logic in use-compose-view.tsx.
 */
export function composeViewSource() {
  return ["ComposeView.tsx", "use-compose-view.tsx"]
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .join("\n");
}
