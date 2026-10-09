/**
 * Which of a thread's messages a page shows (lib/mail/thread-window.ts).
 *
 * The Gmail reader and the local copy's reader both page a thread with it.
 * Ids stand oldest first; the page size here is 3 and the radius around a
 * message is the app's own.
 */

import { threadWindow } from "@/lib/mail/thread-window";
import { THREAD_AROUND_RADIUS } from "@/lib/mail/thread-classify";

import { check, suite } from "./harness.mjs";

const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
const shown = (w) => (w ? `${w.start}-${w.end} older:${w.hasOlder} newer:${w.hasNewer}` : "none");

suite(async () => {
  check("with nothing asked, the newest page", shown(threadWindow(ids, undefined, 3)) === "7-10 older:true newer:false", shown(threadWindow(ids, undefined, 3)));
  check("a thread shorter than a page is all of it", shown(threadWindow(["a", "b"], undefined, 3)) === "0-2 older:false newer:false");
  check("oldest is the first page", shown(threadWindow(ids, { oldest: true }, 3)) === "0-3 older:false newer:true");
  check("after a message, the page after it", shown(threadWindow(ids, { after: "m2" }, 3)) === "3-6 older:true newer:true");
  check("after the last message, nothing", threadWindow(ids, { after: "m9" }, 3) === null);
  check("after an id the thread does not hold, nothing", threadWindow(ids, { after: "zz" }, 3) === null);
  check("before a message, the page before it", shown(threadWindow(ids, { before: "m5" }, 3)) === "2-5 older:true newer:true");
  check("before the first message, nothing", threadWindow(ids, { before: "m0" }, 3) === null);
  check("before an id the thread does not hold, nothing", threadWindow(ids, { before: "zz" }, 3) === null);

  const long = Array.from({ length: THREAD_AROUND_RADIUS * 3 }, (_, i) => `x${i}`);
  const mid = THREAD_AROUND_RADIUS + 10;
  const around = threadWindow(long, { around: `x${mid}` }, 3);
  check(
    "around a message, the radius either side",
    around.start === mid - THREAD_AROUND_RADIUS && around.end === mid + THREAD_AROUND_RADIUS + 1,
    shown(around)
  );
  check("around a message near the start, from the first", threadWindow(ids, { around: "m1" }, 3).start === 0);
  check("around an id the thread does not hold, the newest page", shown(threadWindow(ids, { around: "zz" }, 3)) === "7-10 older:true newer:false");
  check("around wins over the others when several are asked", shown(threadWindow(ids, { around: "m9", oldest: true }, 3)).startsWith("0-10"));
});
