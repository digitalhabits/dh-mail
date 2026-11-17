/**
 * The words of the "You forwarded this" strip: who the forward went to, and
 * when. See components/mail/thread-forward-mark.tsx.
 *
 * No React here, so a suite can read it.
 */

import { shortDate } from "@/lib/mail/date-format";
import { currentMailLocale, type MailT } from "@/lib/mail/i18n-strings";
import type { MailForwardLink } from "@/lib/mail/store/types";

/** "Sigrid Sten", "Sigrid Sten and Tove Holm", "Sigrid Sten, Tove Holm and 2 more". */
export function forwardedWho(to: MailForwardLink["to"], t: MailT): string {
  const names = to.map((p) => p.name?.trim() || p.email).filter(Boolean);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return t("forwardedTwo", { first: names[0], second: names[1] });
  return t("forwardedMany", { first: names[0], second: names[1], count: names.length - 2 });
}

/** The words of a strip line. `now` is given so a suite can set the day. */
export function forwardedWords(link: MailForwardLink, t: MailT, now: Date = new Date()): string {
  const at = new Date(link.sentAt);
  const time = at.toLocaleTimeString(currentMailLocale(), { hour: "2-digit", minute: "2-digit" });
  const today = at.toDateString() === now.toDateString();
  const who = forwardedWho(link.to, t);
  const date = shortDate(at.toISOString());
  if (link.kind === "reply") {
    if (who) return today ? t("repliedApartToToday", { who, time }) : t("repliedApartToOn", { who, date, time });
    return today ? t("repliedApartToday", { time }) : t("repliedApartOn", { date, time });
  }
  if (who) return today ? t("forwardedToToday", { who, time }) : t("forwardedToOn", { who, date, time });
  return today ? t("forwardedToday", { time }) : t("forwardedOn", { date, time });
}

/** The lines the strip shows: the newest forward and the newest reply, the newer of the two first. */
export function stripLines(links: MailForwardLink[]): MailForwardLink[] {
  const newest = (kind: "forward" | "reply") =>
    links.filter((l) => (l.kind ?? "forward") === kind).sort((a, b) => b.sentAt - a.sentAt)[0];
  return [newest("forward"), newest("reply")].filter((l): l is MailForwardLink => Boolean(l)).sort((a, b) => b.sentAt - a.sentAt);
}

/** Which arrow a list row has: the newer of the two actions, or none. */
export function rowMarkKind(forwardedAt?: string, repliedApartAt?: string): "forward" | "reply" | null {
  if (!forwardedAt && !repliedApartAt) return null;
  if (!forwardedAt) return "reply";
  if (!repliedApartAt) return "forward";
  return Date.parse(repliedApartAt) > Date.parse(forwardedAt) ? "reply" : "forward";
}
