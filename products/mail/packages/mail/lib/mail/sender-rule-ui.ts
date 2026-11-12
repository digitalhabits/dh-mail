/**
 * The interface's side of the rules for a sender (lib/mail/sender-rules.ts):
 * what the row menu and the rule dialog ask of the app, and the one place
 * the dialog is opened from.
 */

import { mailApiJson } from "@/lib/mail/api";
import { mailSay } from "@/lib/mail/i18n-strings";
import type { SenderRule, SenderRuleAction, SenderRuleMatch } from "@/lib/mail/sender-rules";
import { toast } from "@/lib/mail/toast";

/** What the app knows of a row's sender. `sender` is null when the conversation is all the reader's own. */
export type SenderRuleState = {
  sender: { name: string; email: string } | null;
  /** The sender's domain, or "" when a rule for the whole domain is not offered. */
  domain: string;
  rule: SenderRule | null;
  /** How many inbox conversations each kind of rule would take now. */
  here: { sender: number; domain: number };
};

export async function readSenderRuleState(row: { account: string; threadId: string; fromEmail?: string }): Promise<SenderRuleState> {
  const params = new URLSearchParams({ account: row.account, threadId: row.threadId });
  if (row.fromEmail) params.set("from", row.fromEmail);
  const json = await mailApiJson<Partial<SenderRuleState>>(`/api/mail/rules/sender?${params.toString()}`);
  return {
    sender: json.sender ?? null,
    domain: json.domain ?? "",
    rule: json.rule ?? null,
    here: json.here ?? { sender: 0, domain: 0 },
  };
}

export type SenderRuleDraft = {
  account: string;
  match: SenderRuleMatch;
  value: string;
  name: string;
  action: SenderRuleAction;
  folderName?: string;
  moveExisting: boolean;
};

/** Keep a rule, and say so. False when it was not kept. */
export async function saveSenderRuleFromUi(draft: SenderRuleDraft): Promise<boolean> {
  try {
    const json = await mailApiJson<{ moved?: number }>("/api/mail/rules/save", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    const moved = json.moved ?? 0;
    toast.success(
      moved === 0 ? mailSay("ruleSaved") : moved === 1 ? mailSay("ruleSavedMovedOne") : mailSay("ruleSavedMoved", { count: moved })
    );
    return true;
  } catch (err) {
    toast.error(err instanceof Error && err.message ? err.message : mailSay("ruleNotSaved"));
    return false;
  }
}

export async function removeSenderRuleFromUi(id: string): Promise<boolean> {
  try {
    await mailApiJson("/api/mail/rules/remove", { method: "POST", body: JSON.stringify({ id }) });
    toast.success(mailSay("ruleRemoved"));
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : mailSay("ruleNotSaved"));
    return false;
  }
}

/** What the rule dialog opens with. */
export type SenderRuleDialogInput = {
  account: string;
  state: SenderRuleState & { sender: { name: string; email: string } };
  /** The destination chosen in the menu, when one was. */
  action?: SenderRuleAction;
};

const OPEN_EVENT = "dh-mail-sender-rule-dialog";

/** Open the rule dialog. The page holds it (SenderRuleDialogHost), since the menu that asks is gone by then. */
export function openSenderRuleDialog(input: SenderRuleDialogInput): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: input }));
}

export function onSenderRuleDialog(open: (input: SenderRuleDialogInput) => void): () => void {
  const listener = (event: Event) => open((event as CustomEvent<SenderRuleDialogInput>).detail);
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
