/**
 * The empty reply box names who the reply goes to.
 *
 * It used to name the first person on the thread who was not you, whatever
 * was in the To and Cc fields. On a reply-all that read as a reply to one
 * person. Now the names come from the recipients themselves, so the
 * placeholder and the "Replying to" line above it agree.
 *
 * No React in here, so a test can read it.
 */

import type { MailRecipient } from "./contact-list-types";
import { mailSay } from "./i18n-strings";

type NamedMessage = {
  fromName: string;
  fromEmail: string;
  own: boolean;
};

export function replyPlaceholderNames(input: {
  toList: readonly MailRecipient[];
  ccList: readonly MailRecipient[];
  messages: readonly NamedMessage[];
  /** The mailbox this reply leaves from. Never named as a recipient. */
  account: string;
}): string[] {
  const nameByEmail = new Map<string, string>();
  const own = new Set<string>([input.account.toLowerCase()]);
  for (const m of input.messages) {
    const email = m.fromEmail.toLowerCase();
    if (m.own) own.add(email);
    else if (m.fromName && !nameByEmail.has(email)) {
      nameByEmail.set(email, m.fromName);
    }
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of [...input.toList, ...input.ccList]) {
    let label: string;
    if (r.kind === "list") {
      label = r.name;
    } else {
      const email = r.email.toLowerCase();
      if (own.has(email)) continue;
      label = nameByEmail.get(email) || r.name || r.email;
    }
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return names;
}

/**
 * "Reply to Ada", "Reply to Ada and 6 others", or "Reply to the thread…".
 *
 * The first person, and how many more. Every name in a row ran to three
 * lines on a reply-all and was cut off anyway; the count is the part worth
 * knowing before you type, and the "Replying to" line above holds the rest.
 */
export function replyPlaceholder(names: readonly string[], fallback: string): string {
  if (!names.length) return mailSay("replyToFallback", { name: fallback });
  const others = names.length - 1;
  if (others === 0) return mailSay("replyToOne", { name: names[0] });
  if (others === 1) return mailSay("replyToOneOther", { name: names[0] });
  return mailSay("replyToOthers", { name: names[0], count: others });
}
