/**
 * The order the mailboxes sit in.
 *
 * A mailbox is dragged to a place between two others, not onto one of them:
 * there is nothing to be inside a mailbox, and a list of them has only an
 * order. So the move is said as "put this one before that one", and the end
 * of the list is `null` — the place after everything.
 *
 * Where the order is kept is the other half of this file. Not with the
 * provider: Gmail and Outlook each keep their own list, and the app reads one
 * after the other, so those two cannot say "this Outlook mailbox sits between
 * those two Gmail ones" between them. The reader's arrangement is a
 * preference, and it lives with the preferences.
 *
 * No React here, so a test can read it. The subscription a row watches it
 * with is in `@/lib/mail/use-account-order`, kept apart the way the
 * shortcuts keep theirs.
 */

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * `moved` goes in front of `before`, or to the end when `before` is null.
 *
 * The list comes back unchanged when the move would change nothing: a mailbox
 * dropped in front of itself, or in front of the one already behind it, is a
 * drag that thought better of it.
 */
export function moveAccountBefore(
  order: string[],
  moved: string,
  before: string | null
): string[] {
  const from = order.findIndex((email) => sameEmail(email, moved));
  if (from < 0) return order;
  if (before !== null && sameEmail(moved, before)) return order;
  const rest = order.filter((_, index) => index !== from);
  if (before === null) return [...rest, order[from]];
  const at = rest.findIndex((email) => sameEmail(email, before));
  if (at < 0) return order;
  return [...rest.slice(0, at), order[from], ...rest.slice(at)];
}

/** Where a mailbox sits on the rail, as the rail draws it. */
export type AccountSpan = { account: string; top: number; bottom: number };

/**
 * Which mailbox a drop at `y` would put the dragged one in front of.
 *
 * `null` is the end of the list, and `undefined` means the drop would change
 * nothing — a place the rail draws no line for.
 *
 * The rail is read as a chain of middles: the pointer belongs to the first
 * mailbox whose middle is still below it. So the whole top of the rail —
 * everything above the first middle, however far above — means the top of
 * the list, and everything below the last middle means the end. That matters
 * because a rail has no place above its first mailbox to point at: with the
 * top of the first section as the boundary instead, the one position a
 * reader most often wants was the one position the rail could not be given.
 *
 * Spans come in the order the rail lists them, and only their middles are
 * read, so a gap between two of them belongs to one or the other rather than
 * to neither.
 */
export function accountDropPlace(
  order: string[],
  spans: AccountSpan[],
  moved: string,
  y: number
): string | null | undefined {
  let before: string | null = null;
  for (const span of spans) {
    if (y < span.top + (span.bottom - span.top) / 2) {
      before = span.account;
      break;
    }
  }
  const next = moveAccountBefore(order, moved, before);
  if (next.join(">") === order.join(">")) return undefined;
  return before;
}

export const MAIL_ACCOUNT_ORDER_KEY = "redd-plan-mail-account-order";
export const MAIL_ACCOUNT_ORDER_EVENT = "redd-plan-mail-account-order-changed";

/**
 * The order the reader arranged, if they have arranged one.
 *
 * Kept here rather than with the provider, because the provider cannot hold
 * it: a Gmail mailbox and an Outlook one live in different tables, each with
 * its own order, and the app reads one list after the other. A reader who
 * wants their Outlook mailbox in the middle of the Gmail ones is asking for
 * something those two lists cannot say between them.
 *
 * So it is a preference, and it sits with the other preferences — the theme,
 * the reading pane, the language. Every mailbox in it is lowercased.
 */
export function readAccountOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MAIL_ACCOUNT_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function writeAccountOrder(order: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      MAIL_ACCOUNT_ORDER_KEY,
      JSON.stringify(order.map((email) => email.trim().toLowerCase()))
    );
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(MAIL_ACCOUNT_ORDER_EVENT));
}

/**
 * The mailboxes, in the reader's order.
 *
 * A mailbox the order has never heard of — connected after the last drag —
 * keeps its place among the others rather than being pushed to the end: it
 * follows the mailbox it came after in the list as given. A mailbox in the
 * order that is no longer connected is passed over.
 */
/**
 * A new order for the mailboxes, keeping everything else where it stands.
 *
 * The arrangement holds one entry that is not a mailbox — the All tab — and
 * a surface that reorders mailboxes alone must not lose it. The settings
 * panel is that surface: it lists mailboxes and nothing else, so the row it
 * hands back is spliced into the arrangement at the places the mailboxes
 * already occupied.
 */
export function mergeAccountOrder(
  current: string[],
  accounts: string[]
): string[] {
  const moving = new Set(accounts.map((email) => email.trim().toLowerCase()));
  const queue = [...accounts];
  const out: string[] = [];
  for (const entry of current) {
    if (moving.has(entry.trim().toLowerCase())) {
      const next = queue.shift();
      if (next) out.push(next);
      continue;
    }
    out.push(entry);
  }
  // Mailboxes the arrangement had never heard of go on the end.
  out.push(...queue);
  return out;
}

export function sortAccountsByOrder(
  accounts: string[],
  order: string[]
): string[] {
  if (!order.length) return accounts;
  const rank = new Map(order.map((email, index) => [email, index]));
  const seat = (email: string) => rank.get(email.trim().toLowerCase());
  let last = -1;
  // A known mailbox sits at its own rank. An unknown one sits just after the
  // last known mailbox above it, so a new account lands where it was listed.
  const seats = accounts.map((email) => {
    const known = seat(email);
    if (known !== undefined) {
      last = known;
      return { email, rank: known, tie: 0 };
    }
    return { email, rank: last, tie: 1 };
  });
  return seats
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) => a.rank - b.rank || a.tie - b.tie || a.index - b.index
    )
    .map((entry) => entry.email);
}

/**
 * The All tab's place in the row, kept in the same arrangement.
 *
 * It is a tab like the others as far as the row is concerned — the reader
 * can put it where they want it — and it is not a mailbox, so everything
 * that reads this list for mailboxes passes over it: an entry that names no
 * connected account is skipped, and this one names none.
 */
export const ALL_TAB_ID = "all";

