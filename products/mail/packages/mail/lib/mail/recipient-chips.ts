/**
 * Keyboard rules for the recipient chips.
 *
 * No React here, on purpose: this is the part a suite reads. The field
 * itself is `components/mail/RecipientField`.
 */

import type { MailRecipient } from "@/lib/mail/contact-list-types";

/**
 * Which chip to select once some have been deleted.
 *
 * Deleting one in the middle of a list should leave you standing where it
 * was — on the one that slid into its place — so a run of them can be
 * cleared without finding your way back from the end of the row each time.
 * Deleting the last one leaves you on the new last one; deleting them all
 * leaves nothing to stand on and hands the cursor back to the input.
 *
 * `from` is the lowest index removed. `remaining` is how many chips are left.
 */
export function chipSelectionAfterRemoval(
  from: number,
  remaining: number
): number | null {
  if (remaining <= 0) return null;
  return Math.min(from, remaining - 1);
}

/**
 * The selected chips, as text to put on the clipboard.
 *
 * "Name <address>" where a name is known, the bare address otherwise, joined
 * the way a To field writes them. That is what every mail client reads back,
 * including this one — copying out of a thread and into a new message keeps
 * the names rather than reducing everybody to an address.
 *
 * A saved list gives up its members: the list is ours, and nowhere it is
 * pasted has ever heard of it.
 */
export function recipientsToClipboardText(values: MailRecipient[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (email: string, name?: string) => {
    const address = email.trim();
    const key = address.toLowerCase();
    if (!address || seen.has(key)) return;
    seen.add(key);
    const label = (name ?? "").trim();
    out.push(label && label.toLowerCase() !== key ? `${label} <${address}>` : address);
  };
  for (const value of values) {
    if (value.kind === "email") add(value.email, value.name);
    else for (const m of value.members) add(m.email, m.name);
  }
  return out.join(", ");
}
