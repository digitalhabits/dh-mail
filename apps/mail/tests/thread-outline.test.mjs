/**
 * A long thread's outline shows the whole thread, loaded or not.
 *
 * The reader loads fifty messages at a time; the outline reads every
 * message's headers and first words in one light request, and the loaded
 * copy of a message stands in for its outline row. Invented addresses.
 */

import { mergeOutline } from "@/lib/mail/outline-merge";
import { outlineFromLocalStore } from "@/lib/mail/local-thread";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const me = "reader@mail.example";
const bo = { name: "Bo Bramble", email: "bo@partner.example" };

function row(id, at, from, extra = {}) {
  return {
    messageId: id,
    threadId: "t",
    fromName: from.name,
    fromEmail: from.email,
    to: [],
    cc: [],
    bcc: [],
    subject: "Plans",
    snippet: `first words of ${id}`,
    sentAt: at,
    hasAttachments: false,
    unread: false,
    starred: false,
    isDraft: false,
    labels: ["INBOX"],
    rfcMessageId: `<${id}@x.test>`,
    ...extra,
  };
}

suite(async () => {
  setMailStore({
    settings: { get: async () => "on", set: async () => {} },
    sync: { list: async () => [{ account: me, folder: "", phase: "live" }], set: async () => {} },
    messages: {
      thread: async () => [
        row("m3", 3_000, bo, { unread: true, hasAttachments: true }),
        row("m1", 1_000, bo),
        row("m2", 2_000, { name: "Reader", email: me }),
        row("d1", 4_000, { name: "Reader", email: me }, { isDraft: true }),
      ],
      copies: async () => [],
    },
  });

  const items = await outlineFromLocalStore(me, "t");
  check("every message, oldest first, the draft left out", items.map((i) => i.id).join(",") === "m1,m2,m3", items.map((i) => i.id).join(","));
  check("the reader's own message is theirs", items[1].own === true && items[0].own === false);
  check("unread and files are carried, without a body", items[2].unread === true && items[2].hasAttachments === true && items[2].firstLine === "first words of m3");

  // The reader has loaded only the newest message: the rest come from the outline.
  const loaded = [
    {
      id: "m3",
      rfcMessageId: "<m3@x.test>",
      fromName: bo.name,
      fromEmail: bo.email,
      sentAt: new Date(3_000).toISOString(),
      bodyText: "> quoted\nThe loaded words",
      own: false,
    },
  ];
  const merged = mergeOutline(loaded, items);
  check("the whole thread, in order", merged.map((e) => e.id).join(",") === "m1,m2,m3", merged.map((e) => e.id).join(","));
  check("what is not loaded says so", merged[0].loaded === false && merged[1].loaded === false);
  const newest = merged[2];
  check("the loaded copy wins: its words, and read now", newest.loaded && newest.firstLine === "The loaded words" && newest.unread === false, JSON.stringify(newest));

  // A provider's second copy (Sent and Inbox) has another id but the same Message-ID.
  const copy = [{ ...loaded[0], id: "m3-sent" }];
  const once = mergeOutline(copy, items);
  check("a copy under another id is matched by its Message-ID, not shown twice", once.length === 3 && once[2].id === "m3-sent", once.map((e) => e.id).join(","));

  // A message sent after the outline was read is still drawn.
  const later = mergeOutline([...loaded, { ...loaded[0], id: "m4", rfcMessageId: "<m4@x.test>", sentAt: new Date(5_000).toISOString() }], items);
  check("a loaded message the outline did not have is added in its place", later.map((e) => e.id).join(",") === "m1,m2,m3,m4", later.map((e) => e.id).join(","));

  check("with no outline, the loaded messages stand alone", mergeOutline(loaded, null).map((e) => e.id).join(",") === "m3");
});

suite(async () => {
  const { ownWords } = await import("@/lib/mail/outline-merge");
  check("a reply's quote card is left out", ownWords("> Bo: “Med shift-enter sker der ikke noget”\n\nJa, det tænkte jeg også") === "Ja, det tænkte jeg også");
  check("also flattened, as a preview has it", ownWords("“Det kan sagtens gøres til et brugervalg i chatten?” Den burde tilføje hele historien.") === "Den burde tilføje hele historien.");
  check("the history after 'On … wrote:' is left out", ownWords("Yes, Thursday works. On 14 Aug 2026, at 12:00, Bo <bo@partner.example> wrote: > earlier") === "Yes, Thursday works.");
  check("a preview cut off inside the quote keeps what it was given", ownWords("“Det kan sagtens gøres til et") === "“Det kan sagtens gøres til et");
  check("words with no quote are as they were", ownWords("Halleluja!") === "Halleluja!");
});
