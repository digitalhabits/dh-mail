/**
 * The server would not delete a draft. Say so, with its reason.
 *
 * A discard waits out its Undo and then asks the provider. If an Exchange
 * server refuses and the refusal goes only to the page's console, the draft
 * comes back at the next refresh with no word why. Then the reader deletes
 * it again, and again. So the reader sees the reason.
 * The shell writes it to the app's log as well (ews_send.rs).
 */

import { toast } from "@/lib/mail/toast";
import { mailSay } from "@/lib/mail/i18n";

export function draftNotDiscarded(err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);
  console.warn("[mail] could not discard the provider's draft:", err);
  toast.error(mailSay("draftKeptByServer", { reason }));
}
