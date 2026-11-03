/**
 * Diagnostics: a few chosen events written to the app's log, and a report
 * the reader saves and sends us when something goes wrong.
 *
 * Nothing about a person goes in. That is kept by what is written, not only
 * by cleaning it afterwards:
 *
 * - An event names a mailbox by its number ("mailbox 2"), never its address.
 *   The numbers are kept on this computer and never leave it.
 * - No subjects, bodies, names, addresses, server names, tokens or file
 *   names are passed to an event, and the fields are short words and times.
 * - The whole report goes through `scrubDiagnostics` before it is shown, as
 *   a second guard for what other parts of the app wrote to the log.
 *
 * Nothing is sent anywhere. The reader sees the report, saves it, and
 * chooses whether to send it (Help → Save Diagnostics…).
 */

import { tauriInvoke } from "@/lib/mail/store/tauri";
import { MAIL_DIAG_MAILBOX_NUMBERS_KEY } from "@/lib/mail/storage-keys";

/** What stands in for a removed part, so a reader sees that it was there. */
const GONE = {
  address: "[address]",
  link: "[link]",
  token: "[token]",
  ip: "[ip]",
  user: "[user]",
} as const;

/**
 * Remove what could say who someone is, from any text.
 *
 * The order matters: links before addresses (a link can hold one), tokens
 * before long runs of letters. Each rule replaces the whole match, so a
 * half-removed address cannot be left behind.
 */
export function scrubDiagnostics(text: string): string {
  return (
    text
      // Links: the host can name a workplace and the path a person.
      .replace(/\b(?:https?|wss?|ftp):\/\/[^\s"'<>)\]]+/gi, GONE.link)
      // Email addresses, with or without a mailto:.
      .replace(/(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, GONE.address)
      // Bearer and Basic credentials, and key=value secrets.
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${GONE.token}`)
      .replace(
        /\b(access_token|refresh_token|id_token|token|code|password|secret|key|api_key)=([^&\s"']+)/gi,
        `$1=${GONE.token}`
      )
      // Long runs of letters and digits: tokens, ids, hashes.
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, GONE.token)
      // IP addresses.
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, GONE.ip)
      // The account name in a home folder path, on a Mac and on Windows.
      .replace(/\/Users\/[^/\s"']+/g, `/Users/${GONE.user}`)
      .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, `$1${GONE.user}`)
  );
}

function readNumbers(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(MAIL_DIAG_MAILBOX_NUMBERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * "mailbox 2": the same number for the same mailbox, day after day, so a
 * log read over a week follows one mailbox. Given out in the order mailboxes
 * are first named, and kept on this computer.
 */
export function mailboxNumber(email: string): string {
  const key = email.trim().toLowerCase();
  if (!key) return "mailbox ?";
  const numbers = readNumbers();
  if (numbers[key] == null) {
    numbers[key] = Math.max(0, ...Object.values(numbers)) + 1;
    try {
      window.localStorage.setItem(MAIL_DIAG_MAILBOX_NUMBERS_KEY, JSON.stringify(numbers));
    } catch {
      // Not kept: the number holds for this session only.
    }
  }
  return `mailbox ${numbers[key]}`;
}

/** A field's value: a word, a number, a time. Nothing longer. */
export type DiagValue = string | number | boolean | null | undefined;

/** A moment as the log reads it, in the computer's own time: "2026-11-03 00:00". */
export function diagTime(ms: number | Date | null | undefined): string {
  if (ms == null) return "none";
  const d = ms instanceof Date ? ms : new Date(ms);
  if (Number.isNaN(d.getTime())) return "none";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hours as the log reads them: "01:00–14:30 Mo Tu We Th Fr · 00:00–00:00 Sa Su", or "none". */
export function diagHours(windows: { start: string; end: string; days: number[] }[] | null | undefined): string {
  if (!windows?.length) return "none";
  const names = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  return windows
    .map((w) => `${w.start}–${w.end} ${[...w.days].sort((a, b) => a - b).map((d) => names[d] ?? "?").join(" ")}`)
    .join(" · ");
}

/** One event as a line: `diag · pause set · mailbox=mailbox 1 · until=…`. */
export function diagLine(event: string, fields: Record<string, DiagValue> = {}): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`);
  return scrubDiagnostics(["diag", event, ...parts].join(" · "));
}

/**
 * Write an event to the app's log. In the desktop app it goes to the same
 * file as the rest of the log; in a browser, to the console only.
 */
export function diagEvent(event: string, fields: Record<string, DiagValue> = {}): void {
  const line = diagLine(event, fields);
  const invoke = tauriInvoke();
  if (!invoke) {
    console.info(line);
    return;
  }
  void Promise.resolve(invoke("mail_diag_log", { line })).catch(() => {
    console.info(line);
  });
}

/** What the report says about one mailbox. No address: its number and kind. */
export type DiagMailbox = {
  number: string;
  /** "gmail", "outlook", "exchange", "imap". */
  kind: string;
  /** "Paused by you until 2026-11-03 00:00", "Hidden by your schedule until …", "As usual". */
  state: string;
  /** The schedules, in the hours alone: "quiet 01:00–14:30 Mon–Fri". */
  hours: string;
  /** The sync's own state: phase and the last error's code, if any. */
  sync: string;
};

export type DiagReportInput = {
  app: string;
  version: string;
  os: string;
  madeAt: Date;
  mailboxes: DiagMailbox[];
  /** The app's log, as read from its file: the last days of it. */
  log: string;
};

/** The computer's offset from UTC at a moment: "UTC+01:00". */
export function diagOffset(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The report, as the reader sees it and saves it. Scrubbed as a whole. */
export function buildDiagnosticsReport(input: DiagReportInput): string {
  const lines = [
    `${input.app} diagnostics`,
    `Made ${diagTime(input.madeAt)}`,
    `Version ${input.version} · ${input.os}`,
    `Times are this computer's own, ${diagOffset(input.madeAt)}`,
    "",
    "This file holds no mail, no addresses and no names. Mailboxes are",
    "numbered. Read it before you send it, if you like.",
    "",
    // The count is of mailboxes: the line for every mailbox's own setting is not one.
    `Mailboxes (${input.mailboxes.filter((box) => box.kind !== "setting").length})`,
    ...input.mailboxes.flatMap((box) => [
      `- ${box.number} (${box.kind})`,
      `  now: ${box.state}`,
      `  hours: ${box.hours}`,
      `  sync: ${box.sync}`,
    ]),
    "",
    "Log",
    input.log.trim() || "(empty)",
    "",
  ];
  return scrubDiagnostics(lines.join("\n"));
}

/** The most page errors one run writes: a loop of them would fill the log. */
const MAX_PAGE_ERRORS = 20;

/** Where an error came from, without the folder: "ThreadPane.tsx:412". */
function placeOf(file: string | undefined, line: number | undefined): string {
  if (!file) return "unknown";
  const name = file.split(/[\\/]/).pop()?.split("?")[0] ?? file;
  return line ? `${name}:${line}` : name;
}

/**
 * Errors the page did not catch, and promises nobody waited on, into the
 * log: what, and where in the code. The same one is written once. Called
 * once per window, at its start.
 */
export function installPageErrorLog(target: Window = window): void {
  let written = 0;
  const seen = new Set<string>();
  const write = (kind: string, message: string, at: string) => {
    const key = `${kind}|${message}|${at}`;
    if (seen.has(key) || written >= MAX_PAGE_ERRORS) return;
    seen.add(key);
    written += 1;
    diagEvent(kind, { at, message: message.replace(/\s+/g, " ").slice(0, 200) });
  };
  target.addEventListener("error", (event: ErrorEvent) => {
    write("page error", event.message || String(event.error ?? "unknown"), placeOf(event.filename, event.lineno));
  });
  target.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: unknown; stack?: unknown } | undefined;
    const message = typeof reason?.message === "string" ? reason.message : String(event.reason ?? "unknown");
    const frame = typeof reason?.stack === "string" ? /\(?([^\s()]+):(\d+):\d+\)?/.exec(reason.stack.split("\n")[1] ?? "") : null;
    write("page promise rejected", message, frame ? placeOf(frame[1], Number(frame[2])) : "unknown");
  });
}

