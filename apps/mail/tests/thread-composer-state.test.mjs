/**
 * The thread composer's state, as a reducer.
 *
 * Two rules here were bugs before they were rules. Words that come from
 * outside the editor need a new editor, or the box keeps the old words. And
 * a restored message with a subject of its own needs the subject row open,
 * or the writer sends under a subject they cannot see.
 */

import {
  composerReducer,
  initialComposerState,
  snapshotPatch,
} from "@/lib/mail/thread-composer-state";
import { check, suite } from "./harness.mjs";

const asta = { email: "asta@haveklub.example", name: "Asta Holm" };
const ragna = { email: "ragna@haveklub.example", name: "Ragna Lund" };

const message = {
  mode: "reply",
  reply: "<p>I can bring the long table.</p>",
  subject: "",
  toList: [asta],
  ccList: [ragna],
  showCc: true,
  editRecipients: false,
  includeSignature: true,
  fromAccount: "ulla@aavang.example",
};

suite(async () => {
  const closed = initialComposerState("ulla@aavang.example");
  check(
    "a new composer is closed, empty, and sends from the thread's mailbox",
    closed.mode === null &&
      closed.reply === "" &&
      closed.fromAccount === "ulla@aavang.example" &&
      closed.editorKey === 0
  );

  // ---- One field at a time: what a control writes ------------------------
  const typed = composerReducer(closed, {
    type: "edit",
    field: "reply",
    value: "<p>Yes.</p>",
  });
  check("the editor writes its own words", typed.reply === "<p>Yes.</p>");
  check(
    "and keeps its editor, because the words came from it",
    typed.editorKey === closed.editorKey
  );

  const grown = composerReducer(closed, {
    type: "edit",
    field: "replyFocus",
    value: (previous) => !previous,
  });
  check("an updater function reads the value before it", grown.replyFocus === true);
  check(
    "and a second one reads the first one's answer",
    composerReducer(grown, {
      type: "edit",
      field: "replyFocus",
      value: (previous) => !previous,
    }).replyFocus === false
  );

  check(
    "a write of the same value is the same state, so nothing renders",
    composerReducer(typed, { type: "edit", field: "reply", value: "<p>Yes.</p>" }) ===
      typed
  );

  // ---- Several fields at once --------------------------------------------
  const opened = composerReducer(typed, {
    type: "patch",
    patch: { mode: "replyAll", toList: [asta, ragna] },
  });
  check(
    "Reply becomes Reply all with the same words in the same editor",
    opened.mode === "replyAll" &&
      opened.reply === "<p>Yes.</p>" &&
      opened.editorKey === typed.editorKey
  );

  const replaced = composerReducer(opened, {
    type: "patch",
    patch: { reply: "<p>A draft from somewhere else.</p>" },
  });
  check(
    "words from outside the editor get a new editor",
    replaced.editorKey === opened.editorKey + 1
  );
  check(
    "and so do no words at all, when the composer closes",
    composerReducer(replaced, { type: "patch", patch: { mode: null, reply: "" } })
      .editorKey === replaced.editorKey + 1
  );
  check(
    "a patch leaves the fields that it does not name",
    replaced.mode === "replyAll" && replaced.toList.length === 2
  );

  // ---- A whole message ----------------------------------------------------
  const plain = snapshotPatch(message);
  check(
    "a message under the thread's own subject keeps the subject row shut",
    plain.subjectDraft === "" && plain.subjectOpen === false
  );
  const renamed = snapshotPatch({ ...message, subject: "Tables for Saturday" });
  check(
    "a message under a subject of its own opens the row",
    renamed.subjectDraft === "Tables for Saturday" && renamed.subjectOpen === true
  );
  check(
    "spaces are not a subject",
    snapshotPatch({ ...message, subject: "   " }).subjectOpen === false
  );
  check(
    "a snapshot has no `subject` field of the state's, only the two it becomes",
    !("subject" in plain)
  );
  check(
    "a field that the snapshot does not name stays as it is",
    !("replyFocus" in plain) &&
      !("quoteMessageId" in plain) &&
      !("showPreview" in plain) &&
      !("updateCrmNotes" in plain)
  );
  check(
    "a field that is named but undefined stays as it is too",
    !("replyFocus" in snapshotPatch({ ...message, replyFocus: undefined }))
  );
  check(
    "a pick that is named as null is cleared, which is not the same thing",
    "quoteMessageId" in snapshotPatch({ ...message, quoteMessageId: null }) &&
      snapshotPatch({ ...message, quoteMessageId: null }).quoteMessageId === null
  );

  const restored = composerReducer(
    { ...closed, replyFocus: true, quoteMessageId: "p1" },
    { type: "patch", patch: plain }
  );
  check(
    "a restore puts the message in a new editor",
    restored.mode === "reply" &&
      restored.reply === message.reply &&
      restored.ccList[0] === ragna &&
      restored.editorKey === closed.editorKey + 1
  );
  check(
    "and leaves the fill and the pick that it did not name",
    restored.replyFocus === true && restored.quoteMessageId === "p1"
  );
});
