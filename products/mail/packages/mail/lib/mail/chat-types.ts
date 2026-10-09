/** Client-safe DTOs for mail conversations (parts + optional chat-style replies). */

export type MailChatRef = {
  chatId: string;
  title: string;
  /** 1-based index of the part this thread binding belongs to. */
  partIndex: number;
  partCount: number;
  /** Subject used for this part (kept stable across parts). */
  subject: string;
  /** Whether this binding is the conversation's open (latest) part. */
  isOpenPart: boolean;
  /** Sticky: replies omit quoted history. */
  noQuote: boolean;
};

export type MailChatDetail = MailChatRef & {
  participantEmails: string[];
  rotateAt: number;
  messageCount: number;
  /** Short display name for the counterpart. */
  counterpartLabel: string;
};

/** One provider-thread segment (for jump menu + cross-part scroll). */
export type MailChatPartSummary = {
  partIndex: number;
  subject: string;
  status: "open" | "closed";
  providerThreadId: string;
  openedAt: string | null;
  closedAt: string | null;
  messageCount: number;
};

/** Stable subject across parts — no “Part N” branding. */
export function chatPartSubject(
  title: string,
  _partIndex: number,
  baseSubject?: string
): string {
  const fromBase = baseSubject?.replace(/\s+/g, " ").trim();
  if (fromBase) return fromBase;
  return title.replace(/\s+/g, " ").trim() || "(no subject)";
}

/** First-name-ish label from a display name or email. */
export function chatTitleFromCounterpart(name: string, email: string): string {
  const fromName = name.split(/[<\(]/)[0]?.trim() || "";
  if (fromName) {
    const first = fromName.split(/\s+/)[0];
    if (first) return first;
  }
  const local = email.split("@")[0]?.trim();
  return local || "Conversation";
}

function shortMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

/** Header jumper labels: date ranges, not Part N. */
export function partJumpLabel(
  part: MailChatPartSummary,
  currentPartIndex: number
): string {
  const start = shortMonthYear(part.openedAt);
  const end =
    part.status === "open" ? "now" : shortMonthYear(part.closedAt) || "now";
  const range =
    start && end ? `${start}–${end}` : start ? `${start}–now` : null;
  if (part.partIndex === currentPartIndex) {
    return range ? `This part · ${range}` : "This part";
  }
  return range ? `Earlier part · ${range}` : "Earlier part";
}
