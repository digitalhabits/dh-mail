/**
 * A subject the writer changed, and everything that can lose it.
 *
 * The composer's state travels through the stored draft: to the floating
 * card, to another thread and back, and out of a pop-out. The record had no
 * subject in it, so a reply written under a new name arrived back under the
 * old one — and went out under the old one, which is what the reader saw in
 * Sent.
 *
 * Read partly as text: both ends are React, and what can be checked here is
 * that the subject is written into the record, read back out of it, and
 * carried by the send that Undo comes back from.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isThreadDraftEmpty } from "@/lib/mail/local-drafts";

import { check, suite } from "./harness.mjs";
import { threadPaneSource } from "./mail-page-source.mjs";

const src = (name) =>
  readFileSync(
    join(process.cwd(), "../../products/mail/packages/mail/components/mail", name),
    "utf8"
  );

const emptyDraft = {
  account: "me@example.org",
  threadId: "t1",
  mode: "reply",
  body: "",
  toList: [],
  ccList: [],
  showCc: false,
  editRecipients: false,
  includeSignature: true,
  fromAccount: "me@example.org",
  replyFocus: false,
  attachments: [],
};

suite(async () => {
  check(
    "a draft with nothing in it is still nothing",
    isThreadDraftEmpty(emptyDraft, [], []) === true
  );

  check(
    "a draft whose only change is the subject is kept",
    isThreadDraftEmpty({ ...emptyDraft, subject: "Slides for Monday" }, [], []) ===
      false
  );

  check(
    "spaces are not a subject",
    isThreadDraftEmpty({ ...emptyDraft, subject: "   " }, [], []) === true
  );

  const pane = threadPaneSource();
  // The composer's state and its stored draft live here now.
  const composer = src("use-thread-composer.ts");
  // And the send, the outbox and Undo live here. The pane keeps the rule
  // for a renamed reply and the button.
  const sendHook = src("use-thread-send.ts");

  const persist = composer.slice(
    composer.indexOf("const persistThreadDraft"),
    composer.indexOf("void saveThreadDraft(")
  );
  check(
    "the saved draft carries the subject",
    persist.includes("subject: snapshot.subject.trim() || undefined"),
    persist.includes("subject:") ? "written" : "missing"
  );

  /*
    A restore writes the whole message through one function, and that
    function opens the row for a subject. mounted-composer-send checks the
    same two things in a mounted pane: a forward comes back under the
    subject that was typed, in an open row.
  */
  const hydrateAt = composer.indexOf('if (raw?.kind === "thread") {');
  const hydrate = composer.slice(
    hydrateAt,
    composer.indexOf("setLocalDraftAt(", hydrateAt)
  );
  check(
    "the composer opens under the subject it was saved with",
    hydrate.includes("subject: raw.subject ?? \"\","),
    hydrate.includes("subject:") ? "read back" : "missing"
  );
  const composerState = readFileSync(
    join(
      process.cwd(),
      "../../products/mail/packages/mail/lib/mail/thread-composer-state.ts"
    ),
    "utf8"
  );
  const snapshotPatch = composerState.slice(
    composerState.indexOf("function snapshotPatch")
  );
  check(
    "and the subject row is open, so the writer can see it",
    snapshotPatch.includes("subjectDraft: subject,") &&
      snapshotPatch.includes("subjectOpen: Boolean(subject.trim()),")
  );

  // The hand-back from the pop-out lives with the card and the pop-out.
  const homeHook = src("use-composer-home.ts");
  const adopt = homeHook.slice(
    homeHook.indexOf("const adoptStoredDraft"),
    homeHook.indexOf("const bringBackPopout")
  );
  check(
    "a draft handed back from the pop-out keeps it too",
    adopt.includes("restoreComposer(") &&
      adopt.includes("subject: raw.subject ?? \"\",")
  );

  const outbox = sendHook.slice(
    sendHook.indexOf("const entry: OutboxEntry = {"),
    sendHook.indexOf("threadId: crossAccount ? undefined : threadId,")
  );
  check(
    "the message waiting out its Undo remembers its subject",
    outbox.includes("subject: subjectDraft,")
  );

  // Undo and a forward that failed share one way back into the composer.
  const undo = sendHook.slice(
    sendHook.indexOf("const putBackFromOutbox = React.useCallback"),
    sendHook.indexOf("const dispatchOutboxSendRef = React.useRef")
  );
  check(
    "and Undo puts it back in the box with the words",
    undo.includes("restoreComposer(") &&
      undo.includes("subject: entry.subject,"),
    undo.includes("subject:") ? "restored" : "missing"
  );

  /*
    What a changed subject means. Gmail and Outlook both start a new
    conversation on a renamed reply, and Gmail only adds a message to a
    thread when the subject matches — so the thread's id is left off and
    the trail is left to In-Reply-To and References.
  */
  // That a renamed reply is a new conversation, sent without the thread's
  // id and still answering the message, is walked in mounted-composer-send.
  // A forward, which is never a reply, is checked here.
  const rule = pane.slice(
    pane.indexOf("const startsNewThread ="),
    pane.indexOf(";", pane.indexOf("subjectDraft.trim() !== replySubject.trim()"))
  );
  check(
    "a forward is not a new conversation, having always started its own",
    rule.includes("!forwarding")
  );

  check(
    "no bubble is put in a thread the message is not joining",
    sendHook.includes("if (!startsNewThread) {\n      setThread((current) =>")
  );

  /* The gesture: asking for a new subject takes the message out of the
     thread, the way Gmail pops the reply out. */
  const button = pane.slice(
    pane.indexOf("{!forwarding && !subjectOpen ? ("),
    pane.indexOf('{t("changeSubject")}')
  );
  check(
    "Change subject floats the message into the card",
    button.includes("floatReply({"),
    button.includes("floatReply") ? "floated" : "missing"
  );
  check(
    "with the subject it just set, not the one on screen",
    button.includes("subject: replySubject,")
  );
  check(
    "and not when it is already in the card, or there is no card",
    button.includes("if (!floating && onFloatReply) {")
  );
});
