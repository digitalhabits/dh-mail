/**
 * The subject of a reply has one reply mark. A reply to "RE: …" or "SV: …"
 * went out as "Re: RE: …", and an Exchange mailbox then filed the answer to
 * it as a conversation of its own (2026-11-12).
 */

import { hasReplyMark, replySubjectOf } from "@/lib/mail/reply-subject";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check("a plain subject gets Re:", replySubjectOf("Exam question") === "Re: Exam question");
  check("a subject with Re: keeps it", replySubjectOf("Re: Exam question") === "Re: Exam question");
  check("Outlook's RE: counts", replySubjectOf("RE: Exam question") === "RE: Exam question");
  check("a Danish SV: counts", replySubjectOf("SV: Workshop") === "SV: Workshop");
  check("a German AW: and a Finnish VS: count", hasReplyMark("AW: Termin") && hasReplyMark("vs: Kokous"));
  check("a mark with a counter counts", hasReplyMark("Re[2]: Plans") && hasReplyMark("RE (3): Plans"));
  check("a forward is not a reply: it gets Re:", replySubjectOf("FW: Minutes") === "Re: FW: Minutes");
  check("a word that only starts like a mark is not one", replySubjectOf("Result: passed") === "Re: Result: passed" && replySubjectOf("Review: draft") === "Re: Review: draft");
  check("no subject still makes a reply", replySubjectOf("") === "Re: ");
});
