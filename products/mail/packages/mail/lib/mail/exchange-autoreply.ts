/**
 * The auto-reply of an Exchange (EWS) mailbox (section 16.2 of
 * `docs/mail-exchange-ews.md`).
 *
 * Exchange keeps it as `OofSettings`: a state (`Disabled`, `Enabled`,
 * `Scheduled`), who outside gets it (`None`, `Known`, `All`), a start and
 * an end, and an internal and an external reply. This maps it to the
 * dialog's fields, as the Outlook branch maps Graph's
 * `automaticRepliesSetting` (`outlook-inbox.ts`). The requests are in Rust
 * (`ews_oof.rs`).
 */

import { invoke } from "@/lib/mail/exchange-native";

/** The auto-reply as `ews_oof.rs` gives and takes it. */
export type ExchangeOof = {
  state: "Disabled" | "Enabled" | "Scheduled";
  externalAudience: "None" | "Known" | "All";
  /** UTC. A time with no zone is UTC too. */
  start: string | null;
  end: string | null;
  /** HTML. */
  internal: string;
  external: string;
};

/** What the dialog shows and saves. */
export type ExchangeAutoReply = {
  enabled: boolean;
  bodyHtml: string;
  restrictToContacts: boolean;
  startTime: number | null;
  endTime: number | null;
};

/** A time as Exchange takes it: UTC, to the second. */
export function toEwsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A time as Exchange gives it. With no zone, it is UTC. */
export function fromEwsTime(value: string | null): number | null {
  if (!value) return null;
  const zoned = /(?:[zZ]|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(zoned);
  return Number.isNaN(ms) ? null : ms;
}

export function oofToAutoReply(oof: ExchangeOof): ExchangeAutoReply {
  const scheduled = oof.state === "Scheduled";
  return {
    enabled: oof.state !== "Disabled",
    bodyHtml: oof.internal || oof.external || "",
    restrictToContacts: oof.externalAudience === "Known",
    // Exchange keeps the last times also when the reply is not scheduled.
    startTime: scheduled ? fromEwsTime(oof.start) : null,
    endTime: scheduled ? fromEwsTime(oof.end) : null,
  };
}

export function autoReplyToOof(input: ExchangeAutoReply): ExchangeOof {
  // A schedule needs both ends. With one only, the reply is on until it is
  // turned off, as the Outlook branch does.
  const scheduled = input.enabled && input.startTime != null && input.endTime != null;
  return {
    state: !input.enabled ? "Disabled" : scheduled ? "Scheduled" : "Enabled",
    externalAudience: input.restrictToContacts ? "Known" : "All",
    start: scheduled ? toEwsTime(input.startTime!) : null,
    end: scheduled ? toEwsTime(input.endTime!) : null,
    internal: input.bodyHtml,
    external: input.bodyHtml,
  };
}

export async function getExchangeAutoReply(account: string): Promise<ExchangeAutoReply> {
  return oofToAutoReply(await invoke<ExchangeOof>("mail_ews_get_auto_reply", { account }));
}

/** Save, and give back what the server keeps. */
export async function setExchangeAutoReply(account: string, input: ExchangeAutoReply): Promise<ExchangeAutoReply> {
  const reply = autoReplyToOof(input);
  return oofToAutoReply(await invoke<ExchangeOof>("mail_ews_set_auto_reply", { account, reply }));
}
