/**
 * "You might have forgotten to attach a file."
 *
 * The reading that decides whether to ask. It has to be right often enough
 * to be worth an interruption: a prompt that cries wolf is one people learn
 * to click through, and then it is worth nothing on the day it is right.
 */

import { promisesAnAttachment } from "@/lib/mail/attachment-hint";
import { check, suite } from "./harness.mjs";

const asks = (subject, bodyText) => promisesAnAttachment({ subject, bodyText });

suite(async () => {
  // ---- Worth asking about ---------------------------------------------
  check("the plain promise",
    asks("", "Hi Ingo,\n\nI have attached the signed copy."));
  check("said in the subject alone",
    asks("Signed guest agreement attached", "Hi Ingo,\n\nAll good from my side."));
  check("the older word",
    asks("", "Please find enclosed the invoice for September."));
  check("naming the thing",
    asks("", "The details are in the attachment."));
  check("Danish, which half this mailbox is written in",
    asks("", "Hej Henrik,\n\nJeg har vedhæftet den underskrevne aftale."));

  // ---- Not worth asking about ------------------------------------------
  check("nothing about files at all",
    !asks("Thursday", "Sounds good — see you at eleven."));
  check("a file promised for later, not now",
    !asks("", "I'll attach the slides once Anton has finished them."));
  check("thanking somebody for theirs",
    !asks("", "Thanks for the attached — very helpful."));
  check("talking about a file they sent",
    !asks("", "Your attachment would not open on my machine."));
  check("a promise in the part being replied to",
    !asks("Re: Slides", "Sounds good!\n\n> I have attached the slides.\n> Henrik"));
  check("a promise below the signature",
    !asks("", "Sounds good!\n\n--\nVera Holm\nI have attached my details below"));
  check("an empty message asks nothing",
    !asks("", "   "));
});
