/**
 * What a forward carries (components/mail/forward-payload.ts): the message,
 * then the conversation before it, newest first, each message under its own
 * "On …, … wrote:" line, as other mail clients show a chain. Built from the
 * thread, so a conversation written in chat style (no message carries its
 * history) still forwards whole. The mail is invented.
 */

import { Window } from "happy-dom";

import { forwardPayload } from "@/components/mail/forward-payload";

import { check, suite } from "./harness.mjs";

const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

const msg = (id, from, day, words) => ({
  id,
  fromName: from,
  fromEmail: `${from.toLowerCase()}@example.org`,
  toEmails: ["me@example.org"],
  ccEmails: [],
  sentAt: `2026-09-${day}T10:00:00Z`,
  bodyText: words,
  bodyHtml: `<div>${words}</div>`,
  own: false,
});

suite(async () => {
  // Chat style: each message is only its own words.
  const thread = {
    account: "me@example.org",
    threadId: "t1",
    subject: "Plans",
    participants: [],
    messages: [msg("m1", "Alma", "09", "First thoughts."), msg("m2", "Bo", "17", "Any news?"), msg("m3", "Alma", "18", "Love it all.")],
    totalMessageCount: 3,
  };
  const f = forwardPayload({ source: thread.messages[2], thread, olderParts: [] });
  check("the forward is the newest message", f.fromName === "Alma" && f.subject === "Plans");
  const html = f.html ?? "";
  const at = (s) => html.indexOf(s);
  check("its own words first", at("Love it all.") >= 0 && at("Love it all.") < at("Any news?"), html);
  check("then the conversation before it, newest first", at("Any news?") < at("First thoughts.") && at("First thoughts.") > 0, html);
  check("each under its own line", (html.match(/wrote:/g) ?? []).length === 2, html);
  check("and the plain text the same way", f.text.indexOf("Any news?") < f.text.indexOf("First thoughts."), f.text);

  const middle = forwardPayload({ source: thread.messages[1], thread, olderParts: [] });
  check("a forward of an earlier message carries only what came before it", !(middle.html ?? "").includes("Love it all."), middle.html);

  const first = forwardPayload({ source: thread.messages[0], thread, olderParts: [] });
  check("the first message forwards alone", !(first.html ?? "").includes("wrote:"), first.html);

  const partial = forwardPayload({ source: thread.messages[2], thread: { ...thread, totalMessageCount: 10 }, olderParts: [] });
  check("what is not loaded is said as not shown", /7 earlier messages not shown/.test(partial.text), partial.text);
});
