/**
 * When to offer the Mac address book, and when to stop offering it.
 *
 * macOS shows its Contacts prompt once for the life of the install. A reader
 * who answers "Don't Allow" cannot be asked again by any code — only System
 * Settings can undo it. So Mail never triggers that prompt on its own. It asks
 * its own question first, and only a yes reaches macOS.
 *
 * That makes a no cheap, which is the point: it costs the reader nothing and
 * costs Mail nothing, so the offer can be made at a good moment rather than at
 * the first moment.
 *
 * Two offers, then silence. The Contact sources panel stays available for
 * anyone who wants it later, and it is where a reader who said no goes.
 */

const KEY = "redd-plan-mail-mac-contacts-ask";
const MAX_ASKS = 2;

type AskState = { asked: number };

function read(): AskState {
  if (typeof window === "undefined") return { asked: 0 };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { asked: 0 };
    const parsed: unknown = JSON.parse(raw);
    const asked = (parsed as AskState)?.asked;
    return { asked: typeof asked === "number" && asked > 0 ? asked : 0 };
  } catch {
    return { asked: 0 };
  }
}

/** True when Mail still has an offer left to make. */
export function macAsksLeft(): boolean {
  return read().asked < MAX_ASKS;
}

/** Record that the offer was made. Made, not answered — a dismissal counts. */
export function noteMacAsked(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ asked: read().asked + 1 } satisfies AskState)
    );
  } catch {
    /* private mode */
  }
}

/** Stop asking for good, whatever the count says. */
export function stopAskingForMacContacts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ asked: MAX_ASKS } satisfies AskState)
    );
  } catch {
    /* private mode */
  }
}
