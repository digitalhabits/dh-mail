/**
 * When a Gmail or Outlook draft opens in the composer.
 *
 * The timing is the whole difficulty, and getting it wrong is silent: the
 * draft simply never appears, with nothing to say why. That is exactly what
 * happened with the first version, which asked a ref whether the local draft
 * had been looked for — a ref cannot wake an effect, so once the thread
 * painted from cache before IndexedDB answered, the answer never arrived.
 */

import {
  draftPlainTextForComposer,
  shouldImportProviderDraft,
  stripInlineQuotedReply,
  draftBodyForComposer,
  draftHtmlToText,
} from "@/lib/mail/import-provider-draft";

import { matchGmailDraftPage } from "@/lib/gmail/api";

import { check, suite } from "./harness.mjs";

function ask(overrides = {}) {
  return shouldImportProviderDraft({
    hasProviderDraft: true,
    localDraftFound: false,
    localDraftAt: null,
    providerDraftAt: null,
    importedForThread: null,
    threadId: "t1",
    composerOpen: false,
    ...overrides,
  });
}

suite(async () => {
  check("a provider draft with nothing in its way opens", ask() === true);

  check(
    "no provider draft, nothing to open",
    ask({ hasProviderDraft: false }) === false
  );

  // The bug this suite exists for.
  check(
    "while the local draft is still being looked for, it waits",
    ask({ localDraftFound: null }) === false
  );
  check(
    "and it opens once the answer comes back negative",
    ask({ localDraftFound: false }) === true
  );

  // Without a time on each there is nothing to choose between them, and ours
  // is the safer keep: it is the one that was typed here.
  check(
    "with no times to compare, our own draft is kept",
    ask({ localDraftFound: true }) === false
  );

  // Otherwise closing the composer reopens it on the next render.
  check(
    "a thread already offered is not offered again",
    ask({ importedForThread: "t1" }) === false
  );
  check(
    "but a different thread still is",
    ask({ importedForThread: "t0" }) === true
  );

  check(
    "an open composer is never replaced",
    ask({ composerOpen: true }) === false
  );

  check(
    "waiting outranks everything — no early yes on a fresh thread",
    ask({ localDraftFound: null, importedForThread: null }) === false
  );

  // --- What actually goes in the box -------------------------------------

  // The shape a Gmail draft arrives in: the reply, then the whole thread
  // quoted under it with > markers. Imported whole it became one run-on
  // paragraph carrying the entire conversation a second time.
  const draft = [
    "Hi Dana, Thanks — and good to meet you, Sam.",
    "",
    "I've added you both to the list of confirmed participants.",
    "",
    "Alex",
    "",
    "On Tue, 11 Aug 2026 15:16:56 +0000, Dana Fisher wrote:",
    "> Hi Alex",
    "> Two bits of good news!",
    "> The new site works for me.",
  ].join("\n");

  const body = draftPlainTextForComposer(draft);

  check(
    "the reader's own words survive",
    body.includes("good to meet you, Sam"),
    body.slice(0, 80)
  );
  check(
    "the quoted thread does not come with them",
    !body.includes("Two bits of good news"),
    body
  );
  check(
    "no quote markers are left as characters",
    !body.includes("&gt;") && !body.includes("> Hi Alex")
  );
  check(
    "it is HTML, so the line breaks survive the editor",
    body.includes("<p") || body.includes("<br"),
    body.slice(0, 60)
  );
  check(
    "the paragraphs stay separate rather than running together",
    (body.match(/<p/g) ?? []).length >= 2,
    String((body.match(/<p/g) ?? []).length)
  );

  check(
    "a draft with no quote is left whole",
    draftPlainTextForComposer("Just a line.").includes("Just a line.")
  );
  // Better a box with the quote in it than an empty one.
  check(
    "a draft that is only a quote still puts something in the box",
    draftPlainTextForComposer("> only quoted text").length > 0
  );
  check("an empty draft does not throw", typeof draftPlainTextForComposer("") === "string");

  // --- A draft that arrived without its line breaks -----------------------

  // The real one, as it reached the composer: one long line. Every marker in
  // stripQuotedReplies is anchored to a newline, so none of them fired and the
  // whole conversation went in the box as a single paragraph.
  const flat =
    "Hi Dana, Thanks — and good to meet you, Sam. I've added you both to the " +
    "list of confirmed participants. We'll send over course details and " +
    "schedule next week. Looking forward to seeing you there. Alex On Tue, " +
    "11 Aug 2026 15:16:56 +0000, Dana Fisher  wrote: > Hi Alex > > Two bits " +
    "of good news! > > The new site works for me. Looks great.";

  const flatBody = draftPlainTextForComposer(flat);
  check(
    "the reply survives a body with no line breaks",
    flatBody.includes("Looking forward to seeing you there"),
    flatBody.slice(0, 70)
  );
  check(
    "and the quoted chain is cut off it",
    !flatBody.includes("Two bits of good news") && !flatBody.includes("Hi Alex"),
    flatBody
  );

  check(
    "an inline Outlook rule is a cut point",
    stripInlineQuotedReply("My reply. ______________________ From: someone")
      .trim() === "My reply."
  );
  check(
    "a quoted From: header is a cut point",
    stripInlineQuotedReply("My reply. > From: someone@x.org").trim() ===
      "My reply."
  );

  // These must survive: they are things a person writes.
  check(
    "a sentence about writing is not a cut point",
    stripInlineQuotedReply("She wrote: a lovely note.").includes("lovely note")
  );
  check(
    "a greater-than in prose is left alone",
    stripInlineQuotedReply("Revenue > costs this quarter.").includes("costs")
  );
  check(
    "nothing to cut leaves the text as it was",
    stripInlineQuotedReply("Just a reply.") === "Just a reply."
  );

  // --- The draft as Gmail actually sends it -------------------------------

  // One <div>, line breaks as <br>, quote markers as &gt; entities. There is
  // no <p> anywhere, which is what defeated htmlToPlainText: it only turns
  // <br> into a newline inside a <p> and takes textContent otherwise, so the
  // whole draft arrived as a single line with no marker able to match.
  const gmailDraft =
    '<div dir="ltr">Hi Dana,<br><br>Thanks — and good to meet you, Sam. ' +
    "I've added you both to the list of confirmed participants.<br><br>" +
    "Looking forward to seeing you there.<br><br>Alex<br><br>" +
    "On Tue, 11 Aug 2026 15:16:56 +0000, Dana Fisher " +
    "&lt;Dana.Fisher@example.org&gt; wrote:<br>&gt; Hi Alex<br>&gt;<br>" +
    "&gt; Two bits of good news!<br>&gt;<br>&gt; The new site works for me." +
    "</div>";

  const asText = draftHtmlToText(gmailDraft);
  check(
    "the line breaks survive the HTML",
    asText.split("\n").length > 4,
    JSON.stringify(asText.slice(0, 60))
  );
  check(
    "entities are decoded, so the quote markers are real",
    asText.includes("> Hi Alex") && !asText.includes("&gt;"),
    asText.slice(-60)
  );

  const gmailBody = draftBodyForComposer({ bodyHtml: gmailDraft });
  check(
    "the reply comes through",
    gmailBody.includes("Looking forward to seeing you there"),
    gmailBody.slice(0, 70)
  );
  check(
    "the quoted history does not",
    !gmailBody.includes("Two bits of good news") &&
      !gmailBody.includes("wrote:") &&
      !gmailBody.includes("Hi Alex"),
    gmailBody
  );
  check(
    "the paragraphs are paragraphs again",
    (gmailBody.match(/<p/g) ?? []).length >= 3,
    String((gmailBody.match(/<p/g) ?? []).length)
  );

  check(
    "a plain-text body is preferred when the provider sends one",
    draftBodyForComposer({
      bodyText: "Just the text.",
      bodyHtml: "<div>Ignored</div>",
    }).includes("Just the text.")
  );
  check(
    "an empty body does not throw",
    typeof draftBodyForComposer({}) === "string"
  );

  // --- Finding the Gmail draft to throw away ------------------------------
  //
  // A reply written from an imported draft has to take that draft with it, or
  // the provider keeps an unsent copy of a message that has gone out — and
  // offers it back the next time the thread is opened, which is what it looked
  // like when this did not work.
  //
  // Matching on the message id alone is not enough. Gmail gives a draft a new
  // message id every time it saves it, so the id read when the thread was
  // opened is stale the moment the reader touches that draft in Gmail. The
  // thread is what holds still.

  const page = (rows) => rows.map(([id, mid, tid]) => ({
    id,
    message: { id: mid, threadId: tid },
  }));

  const DRAFTS = page([
    ["d1", "m1", "t1"],
    ["d2", "m2", "t2"],
  ]);

  check(
    "the message id is the first answer",
    matchGmailDraftPage(DRAFTS, "m2", "t1").exact === "d2"
  );
  check(
    "the thread is the second, and is kept apart from the first",
    matchGmailDraftPage(DRAFTS, "gone", "t1").exact === null &&
      matchGmailDraftPage(DRAFTS, "gone", "t1").byThread === "d1"
  );
  check(
    "a stale message id still finds the draft by its thread",
    matchGmailDraftPage(DRAFTS, "m1-old-after-a-resave", "t1").byThread === "d1"
  );
  check(
    "no thread to go on means no second answer",
    matchGmailDraftPage(DRAFTS, "gone").byThread === null
  );
  check(
    "a thread with no draft matches nothing",
    matchGmailDraftPage(DRAFTS, "gone", "t9").byThread === null
  );
  check(
    "neither is an answer, not an accident",
    matchGmailDraftPage([], "m1", "t1").exact === null &&
      matchGmailDraftPage([], "m1", "t1").byThread === null
  );
  // Whatever Gmail leaves out must not become a match for something absent.
  check(
    "a draft with no message of its own is not matched by mistake",
    matchGmailDraftPage([{ id: "d9" }], "m1", "t1").exact === null &&
      matchGmailDraftPage([{ id: "d9" }], "m1", "t1").byThread === null
  );

  // --- Which draft opens, when both sides have one ------------------------
  //
  // Ours used to win outright, on the grounds that it is what was typed here
  // and it is saved on a keystroke. True until the same reply is edited in
  // Gmail — and then the box here opens on words that were replaced somewhere
  // else, with nothing to say so. The later one wins now, either way.

  check(
    "ours is older, so theirs opens",
    ask({ localDraftFound: true, localDraftAt: 1_000, providerDraftAt: 2_000 }) ===
      true
  );
  check(
    "ours is newer, so ours stays",
    ask({ localDraftFound: true, localDraftAt: 3_000, providerDraftAt: 2_000 }) ===
      false
  );
  check(
    "the same moment is not later — ours stays",
    ask({ localDraftFound: true, localDraftAt: 2_000, providerDraftAt: 2_000 }) ===
      false
  );
  check(
    "a time on only one side is no comparison — ours stays",
    ask({ localDraftFound: true, localDraftAt: 1_000 }) === false &&
      ask({ localDraftFound: true, providerDraftAt: 2_000 }) === false
  );
  // The guards that stop it reopening what the reader has just closed still
  // come first, however much newer the provider's copy is.
  check(
    "once per thread, however new theirs is",
    ask({
      localDraftFound: true,
      localDraftAt: 1,
      providerDraftAt: 9_999,
      importedForThread: "t1",
    }) === false
  );
  check(
    "never over an open composer",
    ask({
      localDraftFound: true,
      localDraftAt: 1,
      providerDraftAt: 9_999,
      composerOpen: true,
    }) === false
  );
});
