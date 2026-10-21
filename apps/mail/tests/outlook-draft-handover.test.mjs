import { openReplyInOutlook } from "@/lib/mail/outlook-compose";
import { check, suite } from "./harness.mjs";

// "Open in Outlook" for a mailbox this app cannot sign in to: Outlook makes
// the draft itself, a reply in the conversation or a new message, and
// nothing opens. Only when Outlook cannot be asked does a window open.
let calls = [];
let answer = "reply";
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === "outlook_draft") {
          if (answer instanceof Error) throw answer;
          return answer;
        }
        return null;
      },
    },
  },
};
globalThis.window.top = globalThis.window;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { write: async () => undefined, writeText: async () => undefined } }, configurable: true });

const anchor = {
  id: "m1",
  rfcMessageId: "<m1@uni.example>",
  fromEmail: "ines.holm@uni.example",
  sentAt: "2026-10-20T09:00:00Z",
};
const base = {
  own: { html: "<p>Thanks</p>", text: "Thanks" },
  history: { html: "<blockquote>Old</blockquote>", text: "> Old" },
  anchor,
  threadSubject: "Seminar room",
  subject: "Re: Seminar room",
  from: "ada@college.example",
  to: ["ines.holm@uni.example"],
  cc: [],
  bcc: ["list@uni.example"],
  files: [{ filename: "plan.pdf", contentBase64: "AAEC" }],
};

suite(async () => {
  calls = [];
  answer = "reply";
  const replied = await openReplyInOutlook(base);
  const draft = calls[0]?.args?.draft;
  check("a reply is made as a reply draft in Outlook", replied === "replyDraft", replied);
  check("Outlook is told which message it answers", draft?.reply?.messageId === "<m1@uni.example>" && draft?.reply?.subject === "Seminar room");
  check("the words, the Bcc and the files go with it", draft?.html === "<p>Thanks</p>" && draft?.bcc?.[0] === "list@uni.example" && draft?.files?.[0]?.filename === "plan.pdf");
  check("nothing opens a window", !calls.some((c) => c.cmd === "open_outlook_compose"));

  calls = [];
  answer = "new";
  await openReplyInOutlook({ ...base, subject: "Another matter" });
  check("a new subject is not made a reply: it starts its own thread", calls[0]?.args?.draft?.reply === null);
  check("and the history goes under the words", calls[0]?.args?.draft?.historyHtml === "<blockquote>Old</blockquote>");

  calls = [];
  answer = "new";
  const fresh = await openReplyInOutlook({ ...base, anchor: null, history: null, threadSubject: "", subject: "Hello" });
  check("a new message is made as a draft", fresh === "draft", fresh);
  check("in the account it is written from", calls[0]?.args?.draft?.from === "ada@college.example");

  calls = [];
  answer = null;
  const fallback = await openReplyInOutlook({ ...base, own: { html: "<p>Short</p>", text: "Short" } });
  check("when Outlook cannot be asked, a new Outlook message opens as before", fallback === "url" || fallback === "paste", fallback);
  check("through the mailto: route", calls.some((c) => c.cmd === "open_outlook_compose"));
});
