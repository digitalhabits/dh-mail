import { normalizeEmail } from "@/lib/own-addresses";

/**
 * Optional allow-list of mailboxes for this app (comma-separated env).
 * Empty = show every connected account owned by the local user.
 */
function configuredMailEmails(): string[] {
  return (process.env.MAIL_ACCOUNT_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type MailAccountScope = "all" | "personal";

export function isDhMailAccountEmail(email: string): boolean {
  const allow = configuredMailEmails();
  if (allow.length === 0) return true;
  const normalized = normalizeEmail(email);
  return allow.some((e) => normalizeEmail(e) === normalized);
}

/** Infer scope from a Tauri shell userAgent; browsers keep the unified inbox. */
export function detectMailAccountScope(
  userAgent: string | null | undefined
): MailAccountScope {
  if (!userAgent) return "all";
  if (/dh-mail-native/i.test(userAgent)) return "personal";
  return "all";
}

export function filterEmailsForScope(
  emails: string[],
  scope: MailAccountScope
): string[] {
  if (scope === "personal") {
    return emails.filter((email) => isDhMailAccountEmail(email));
  }
  return emails;
}

/**
 * Pick connected accounts for a shell.
 * - Personal: optional MAIL_ACCOUNT_EMAILS allow-list, then `inMailTab`
 *   (Hide in the accounts menu must drop the mailbox from this app's inbox).
 * - All / default: `inMailTab` only.
 */
export function filterAccountsForScope<
  T extends { email: string; inMailTab: boolean },
>(accounts: T[], scope: MailAccountScope): T[] {
  const visible = accounts.filter((a) => a.inMailTab);
  if (scope === "personal") {
    const allow = configuredMailEmails();
    if (allow.length === 0) return visible;
    return visible.filter((a) => isDhMailAccountEmail(a.email));
  }
  return visible;
}
