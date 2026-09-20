/**
 * The Update CRM dialog stays when the reader opens other mail.
 *
 * The proposals are read against mail, and not always the mail they came
 * from. The dialog used to live in the thread pane, and the pane is made
 * again for every thread: opening another message took the proposals away,
 * and the edits made to them. So the dialog lives in CrmProposalHost, and
 * each window mounts that above anything made again per thread.
 *
 * Read as text: what can be checked here is where the dialog is mounted,
 * and that applying acts on the thread the proposals came from.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { check, suite } from "./harness.mjs";

// From the working directory, not from this file: the harness compiles each
// test into a temp directory, so the file's own path leads nowhere.
const src = (name) =>
  readFileSync(
    join(process.cwd(), "../../products/mail/packages/mail/components/mail", name),
    "utf8"
  );

suite(async () => {
  const pane = src("ThreadPane.tsx");
  const host = src("CrmProposalHost.tsx");
  const page = src("MailPage.tsx");
  const reader = src("ThreadReaderWindow.tsx");
  const person = src("PersonReaderWindow.tsx");

  check(
    "the thread pane does not mount the dialog",
    !pane.includes("<CrmProposalDialog"),
    "ThreadPane.tsx still renders <CrmProposalDialog"
  );
  check(
    "the thread pane does not keep the proposals in its own state",
    !/useState<[^>]*CrmProposeResult/.test(pane),
    "ThreadPane.tsx holds CrmProposeResult in useState"
  );
  /*
    The pane's AI and CRM panel now lives in a hook that the pane calls. The
    hook is made again with the pane for every thread, so the same rule
    applies to it: it asks the host for proposals and holds none.
  */
  const assistant = src("use-thread-assistant.ts");
  check(
    "the pane's AI and CRM hook does not keep the proposals in state",
    !/useState<[^>]*CrmProposeResult/.test(assistant) &&
      !assistant.includes("<CrmProposalDialog"),
    "use-thread-assistant.ts holds CrmProposeResult in useState"
  );
  check(
    "it asks the host for them",
    assistant.includes("proposeCrmFromThread({")
  );
  check(
    "the host mounts the dialog",
    host.includes("<CrmProposalDialog")
  );

  const hostMounts = page.split("{crmProposalHost}").length - 1;
  check(
    "the main window mounts the host in the desktop and the phone layout",
    page.includes("<CrmProposalHost") && hostMounts === 2,
    `{crmProposalHost} is placed ${hostMounts} times`
  );
  check(
    "the main window archives the thread the proposals came from",
    page.includes("onArchive={(origin) => void archive(origin)}")
  );
  check(
    "the main window marks that thread as In CRM, and not the selected one",
    page.includes("onCrmChanged={markThreadInCrm}") &&
      page.includes("threadKey(current) === key ? { ...current, inCrm: true }")
  );

  check(
    "a reader window alone mounts its own host",
    reader.includes("crmDialogAbove ? null : (") && reader.includes("<CrmProposalHost")
  );
  check(
    "a person's window holds the host, above the reader it makes per thread",
    person.includes("<CrmProposalHost") && person.includes("crmDialogAbove\n")
  );
  const hostFirst = (person.match(/<>\s*\{crmHost\}/g) ?? []).length;
  check(
    "and it is first in both branches, so it stays mounted between them",
    hostFirst === 2,
    `{crmHost} leads ${hostFirst} of 2 branches`
  );
});
