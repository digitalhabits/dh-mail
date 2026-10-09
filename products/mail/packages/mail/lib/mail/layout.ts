/** Where the mail thread list sits relative to the reading pane. */

export type MailListPlacement = "left" | "right" | "top" | "bottom";

export const MAIL_LIST_PLACEMENT_KEY = "redd-plan-mail-list-placement";
export const MAIL_LIST_PLACEMENT_EVENT = "redd-plan-mail-list-placement";

const ALL: MailListPlacement[] = ["left", "right", "top", "bottom"];

export function isMailListPlacement(value: unknown): value is MailListPlacement {
  return typeof value === "string" && ALL.includes(value as MailListPlacement);
}

export function getMailListPlacement(): MailListPlacement {
  if (typeof window === "undefined") return "left";
  try {
    const stored = localStorage.getItem(MAIL_LIST_PLACEMENT_KEY);
    if (isMailListPlacement(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "left";
}

export function setMailListPlacement(placement: MailListPlacement): void {
  try {
    localStorage.setItem(MAIL_LIST_PLACEMENT_KEY, placement);
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MAIL_LIST_PLACEMENT_EVENT, { detail: placement })
    );
  }
}

/**
 * Whether the filter row is showing.
 *
 * Kept, because it is a way of working rather than a step in one: a reader
 * who lives in In Contacts wants that row every morning, and one who never
 * filters should not be given it back every time the app opens.
 */
export const MAIL_FILTER_ROW_KEY = "redd-plan-mail-filter-row";
export const MAIL_FILTER_ROW_EVENT = "redd-plan-mail-filter-row";

export function getMailFilterRowOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MAIL_FILTER_ROW_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMailFilterRowOpen(open: boolean): void {
  try {
    localStorage.setItem(MAIL_FILTER_ROW_KEY, open ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MAIL_FILTER_ROW_EVENT));
  }
}
