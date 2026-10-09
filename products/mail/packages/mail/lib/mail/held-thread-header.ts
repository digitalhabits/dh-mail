/**
 * The heading of a thread that has only a held message so far.
 *
 * A message the server holds for later opens its conversation from the
 * Outbox group. The local copy has no message in that conversation yet, so
 * the heading said "(no subject) · 0 messages". With no message, the held
 * ones stand in: their subject, their count, and the day they go.
 */

import { shortDate } from "@/lib/mail/date-format";

type Held = { subject: string; sendAt: string };

export function headingWithHeld(
  heading: { subject: string; count: number; dateRange: string },
  held: Held[]
): { subject: string; count: number; dateRange: string } {
  if (heading.count > 0 || !held.length) return heading;
  const named = held.find((h) => h.subject.trim());
  const blank = !heading.subject.trim() || heading.subject.trim() === "(no subject)";
  return {
    subject: blank && named ? named.subject.trim() : heading.subject,
    count: held.length,
    dateRange: heading.dateRange || shortDate(held[0].sendAt),
  };
}
