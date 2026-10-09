/** Lightweight ICS helpers for mail invite cards (display + handoff only). */

export type ParsedCalendarInvite = {
  summary: string;
  start: Date | null;
  end: Date | null;
  /** True when DTSTART is a DATE (no time-of-day). */
  allDay: boolean;
  location: string;
  /** Best join/conference URL if we can find one. */
  joinUrl: string | null;
};

export function isCalendarAttachment(att: {
  mimeType: string;
  filename: string;
}): boolean {
  const mime = att.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (
    mime === "text/calendar" ||
    mime.startsWith("text/calendar") ||
    mime === "application/ics"
  ) {
    return true;
  }
  return att.filename.toLowerCase().endsWith(".ics");
}

/**
 * A message's files, with the same event named only once.
 *
 * A meeting mail carries its event twice — as the `text/calendar` part the
 * message is, and as the `invite.ics` file hung off it — and both answer to
 * `isCalendarAttachment`. Everything that draws an invitation takes the
 * first calendar part and ignores the rest, so anything that counts them
 * should count the same way, or the header says two where the message
 * shows one.
 *
 * Order is kept, and every other file is kept: this only drops the second
 * and later calendar parts.
 */
export function oneInvitePerMessage<
  T extends { mimeType: string; filename: string },
>(attachments: T[] | undefined): T[] {
  if (!attachments?.length) return [];
  let seen = false;
  return attachments.filter((att) => {
    if (!isCalendarAttachment(att)) return true;
    if (seen) return false;
    seen = true;
    return true;
  });
}

/** Walk a MIME part tree (e.g. Gmail metadata payload) for calendar parts. */
export function mimeTreeHasCalendar(part: {
  mimeType?: string;
  filename?: string;
  parts?: Array<{
    mimeType?: string;
    filename?: string;
    parts?: unknown[];
  }>;
} | null | undefined): boolean {
  if (!part) return false;
  if (
    isCalendarAttachment({
      mimeType: part.mimeType || "",
      filename: part.filename || "",
    })
  ) {
    return true;
  }
  for (const child of part.parts ?? []) {
    if (mimeTreeHasCalendar(child as typeof part)) return true;
  }
  return false;
}

/** Unfold RFC 5545 line folds, then split into logical lines. */
function unfoldIcs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const physical = normalized.split("\n");
  const lines: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

type IcsProp = { name: string; params: Record<string, string>; value: string };

function parseProp(line: string): IcsProp | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = left.split(";");
  const name = (segments[0] ?? "").toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { name, params, value };
}

function parseIcsDate(
  value: string,
  params: Record<string, string>
): { date: Date; allDay: boolean } | null {
  // Strip quotes Outlook sometimes wraps around values.
  const raw = value.trim().replace(/^"(.*)"$/, "$1");
  if (!raw) return null;
  const valueParam = (params.VALUE ?? "").toUpperCase().replace(/^"(.*)"$/, "$1");
  const allDay = valueParam === "DATE" || /^\d{8}$/.test(raw);

  if (allDay) {
    const y = Number(raw.slice(0, 4));
    const m = Number(raw.slice(4, 6));
    const d = Number(raw.slice(6, 8));
    if (!y || !m || !d) return null;
    // Local calendar date at noon avoids DST edge display glitches for all-day.
    return { date: new Date(y, m - 1, d, 12, 0, 0, 0), allDay: true };
  }

  // Compact: YYYYMMDDTHHMMSS[Z|+HHMM|+HH:MM] (optional fractional seconds)
  const compact =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      raw
    );
  if (compact) {
    const [, ys, ms, ds, hs, mins, ss, zone] = compact;
    const y = Number(ys);
    const mo = Number(ms);
    const d = Number(ds);
    const h = Number(hs);
    const mi = Number(mins);
    const s = Number(ss);
    if (!zone) {
      // Floating / TZID without a zone database: treat as local wall time.
      return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false };
    }
    if (zone.toUpperCase() === "Z") {
      return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
    }
    const off = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
    if (!off) return null;
    // Wall clock in ±HHMM → UTC: subtract the offset from the stamped time.
    const sign = off[1] === "+" ? -1 : 1;
    const offsetMin = sign * (Number(off[2]) * 60 + Number(off[3]));
    return {
      date: new Date(Date.UTC(y, mo - 1, d, h, mi, s) + offsetMin * 60_000),
      allDay: false,
    };
  }

  // ISO-ish: 2025-09-15T10:00:00Z / with offset
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) {
    return { date: new Date(iso), allDay: false };
  }
  return null;
}

function firstHttpsUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;]+$/, "");
}

export function joinLinkLabel(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (host.includes("teams.microsoft.") || host.includes("teams.live.")) {
    return "Join on Teams";
  }
  if (host.includes("zoom.us") || host.includes("zoom.com")) {
    return "Join on Zoom";
  }
  if (host.includes("meet.google.")) return "Join on Meet";
  return "Join call";
}

/** Parse the first VEVENT in an ICS payload. */
export function parseCalendarInvite(raw: string): ParsedCalendarInvite | null {
  const lines = unfoldIcs(raw);
  let inEvent = false;
  let summary = "";
  let location = "";
  let description = "";
  let url = "";
  let xGoogleConference = "";
  let start: Date | null = null;
  let end: Date | null = null;
  let allDay = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      continue;
    }
    if (upper === "END:VEVENT") break;
    if (!inEvent) continue;

    const prop = parseProp(line);
    if (!prop) continue;

    if (prop.name === "SUMMARY") {
      summary = unescapeIcsText(prop.value).trim();
    } else if (prop.name === "LOCATION") {
      location = unescapeIcsText(prop.value).trim();
    } else if (prop.name === "DESCRIPTION") {
      description = unescapeIcsText(prop.value);
    } else if (prop.name === "URL") {
      url = prop.value.trim();
    } else if (prop.name === "X-GOOGLE-CONFERENCE") {
      xGoogleConference = prop.value.trim();
    } else if (prop.name === "DTSTART") {
      const parsed = parseIcsDate(prop.value, prop.params);
      if (parsed) {
        start = parsed.date;
        allDay = parsed.allDay;
      }
    } else if (prop.name === "DTEND") {
      const parsed = parseIcsDate(prop.value, prop.params);
      if (parsed) end = parsed.date;
    }
  }

  if (!start && !summary) return null;

  const joinUrl =
    (url.startsWith("http") ? url : null) ||
    (xGoogleConference.startsWith("http") ? xGoogleConference : null) ||
    firstHttpsUrl(location) ||
    firstHttpsUrl(description);

  // If LOCATION was only a URL, don't repeat it as plain location text.
  let locationText = location;
  if (joinUrl && locationText.replace(/\s+/g, "") === joinUrl) {
    locationText = "";
  } else if (joinUrl && locationText.includes(joinUrl)) {
    locationText = locationText.replace(joinUrl, "").replace(/\s*[·|]\s*$/, "").trim();
  }

  return {
    summary: summary || "Event",
    start,
    end,
    allDay,
    location: locationText,
    joinUrl,
  };
}

function weekdayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function dayMonth(d: Date, withYear: boolean): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : null),
  });
}

function timeOfDay(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Compact when-label for the mail list chip (start only). */
export function formatInviteChip(
  invite: Pick<ParsedCalendarInvite, "start" | "allDay">
): string | null {
  if (!invite.start) return null;
  const nowYear = new Date().getFullYear();
  const needsYear = invite.start.getFullYear() !== nowYear;
  const day = `${weekdayShort(invite.start)} ${dayMonth(invite.start, needsYear)}`;
  if (invite.allDay) return `${day}, all day`;
  return `${day}, ${timeOfDay(invite.start)}`;
}

/** Hero time line for the invite card. */
export function formatInviteWhen(invite: ParsedCalendarInvite): string {
  const { start, end, allDay } = invite;
  if (!start) return "Time not specified";

  const nowYear = new Date().getFullYear();
  const needsYear = start.getFullYear() !== nowYear;
  const startDay = `${weekdayShort(start)} ${dayMonth(start, needsYear)}`;

  if (allDay) {
    if (end) {
      // ICS all-day DTEND is exclusive; show last inclusive day.
      const last = new Date(end.getTime() - 12 * 60 * 60 * 1000);
      if (!sameCalendarDay(start, last)) {
        const endNeedsYear = last.getFullYear() !== nowYear;
        if (
          start.getMonth() === last.getMonth() &&
          start.getFullYear() === last.getFullYear()
        ) {
          return `${weekdayShort(start)} ${start.getDate()}–${weekdayShort(last)} ${dayMonth(last, endNeedsYear)}, all day`;
        }
        return `${startDay} – ${weekdayShort(last)} ${dayMonth(last, endNeedsYear)}, all day`;
      }
    }
    return `${startDay}, all day`;
  }

  if (!end) return `${startDay}, ${timeOfDay(start)}`;

  if (sameCalendarDay(start, end)) {
    return `${startDay}, ${timeOfDay(start)}–${timeOfDay(end)}`;
  }

  const endNeedsYear = end.getFullYear() !== nowYear;
  return `${startDay}, ${timeOfDay(start)} – ${weekdayShort(end)} ${dayMonth(end, endNeedsYear)}, ${timeOfDay(end)}`;
}
