/**
 * After the CRM is updated, the reader is told every table that changed.
 *
 * The tally asked each applied proposal for a `recordId`. A facilitator
 * course has none — it is a line in the catalogue the Facilitators tab
 * holds, keyed by its Course key — so a course change was counted nowhere.
 * View then went to whichever table was left, the line under it did not
 * say a second table had changed, and a reader who had just approved new
 * food and accommodation wording was taken to Clients.
 *
 * Read as text at both ends: the tally is inside a React handler, and the
 * receiver is in the planner app.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { check, suite } from "./harness.mjs";

const REPO = join(process.cwd(), "../..");
const src = (path) => readFileSync(join(REPO, path), "utf8");

suite(async () => {
  // The dialog and the parts its cards are drawn with, as one text.
  const dialog =
    src("products/mail/packages/mail/components/mail/CrmProposalDialog.tsx") +
    src("products/mail/packages/mail/components/mail/crm-proposal-parts.tsx");

  check(
    "a course names the table it is shown in",
    dialog.includes('const COURSE_TOOLS = new Set<CrmProposal["tool"]>(["update_course"])') &&
      dialog.includes('touch("facilitators", "")'),
    dialog.includes("COURSE_TOOLS") ? "counted" : "dropped"
  );
  check(
    "which a proposal with no record now reaches",
    dialog.includes('} else if (COURSE_TOOLS.has(r.proposal.tool)) {')
  );
  check(
    "and a table with no row is still a table",
    dialog.includes("if (!source) return;") &&
      dialog.includes("if (recordId && !ids.includes(recordId)) ids.push(recordId);"),
    dialog.includes("if (!source || !recordId) return;") ? "still dropped" : "kept"
  );
  check(
    "the other tables are named, not counted",
    dialog.includes("`Also changed: ${others") && dialog.includes("tableLabel(s)"),
    dialog.includes("other table${others > 1") ? "counted" : "named"
  );
  check(
    "and each name is the table's own word, capitalised",
    dialog.includes("source.charAt(0).toUpperCase() + source.slice(1)")
  );

  /* The other end: the planner opens a tab that has no row to scroll to. */
  const receiver = src("components/mail-pane/NativeShowRecord.tsx");
  check(
    "the planner opens a table with no row to scroll to",
    receiver.includes("if (!tabId) return;") &&
      !receiver.includes("if (!tabId || !recordId) return;"),
    receiver.includes("!recordId) return") ? "still refused" : "opens"
  );
  check(
    "and asks for no row when there is none",
    receiver.includes("const embedQuery = recordId") &&
      receiver.includes('router.push(embedQuery ? `/${tabId}?${embedQuery}` : `/${tabId}`)')
  );
  check(
    "the Facilitators tab is one it knows",
    receiver.includes('facilitators: "facilitators"')
  );
});
