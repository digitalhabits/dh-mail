"use client";

/*
 * The out-of-office reply, off MailPage: what each mailbox has set, the mark
 * and the line that say it is on, the dialog that changes it, and the End
 * link in the accounts panel.
 *
 * Owns: the replies as the provider last gave them, which mailbox the dialog
 * opens on, whether it is open, and the one read of all replies a short
 * while after the page mounts.
 *
 * Does not own: the dialog's own form and its saving. That is
 * AutoReplyDialog, which hands each saved reply back through
 * `storeAutoReply`. The markup that shows the line and the marks stays in
 * the page and reads `autoReplies` and `autoReplyByAccount`.
 *
 * One effect: the read, 2.5 seconds after mount, so that it does not compete
 * with the inbox's own requests. The page calls this hook where that effect
 * always stood.
 *
 * New auto-reply work goes in this file, not in MailPage.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { currentMailLocale, type useMailT } from "@/lib/mail/i18n";
import { mailApiFetch } from "@/lib/mail/api";
import {
  autoReplyActive,
  type AutoReplyDto,
} from "@/components/mail/AutoReplyDialog";

export function useAutoReply({ t }: { t: ReturnType<typeof useMailT> }) {
  const [autoReplyOpen, setAutoReplyOpen] = React.useState(false);
  // Which account the auto-reply dialog opens on (from Set up…/Edit links).
  const [autoReplyAccount, setAutoReplyAccount] = React.useState<string | null>(null);
  const [autoReplies, setAutoReplies] = React.useState<AutoReplyDto[]>([]);

  /**
   * Mailboxes answering on their own, for the mark on their tab.
   *
   * The same question the line above the tabs answers in a sentence, put on
   * each mailbox it is true of: whose auto-reply is on, and until when.
   */
  const autoReplyByAccount = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const reply of autoReplies) {
      if (!autoReplyActive(reply)) continue;
      const until =
        reply.endTime !== null
          ? ` ${t("outOfOfficeUntil", {
              date: new Date(reply.endTime - 1).toLocaleDateString(
                currentMailLocale(),
                { day: "numeric", month: "short" }
              ),
            })}`
          : "";
      map.set(
        reply.account.trim().toLowerCase(),
        `${t("autoReplyOn")}${until}`
      );
    }
    return map;
  }, [autoReplies, t]);

  const storeAutoReply = React.useCallback((updated: AutoReplyDto) => {
    setAutoReplies((prev) => [
      ...prev.filter((a) => a.account !== updated.account),
      updated,
    ]);
  }, []);

  // "End" link in the accounts menu: turn the responder off, keep its content.
  const endAutoReply = React.useCallback(
    async (account: string) => {
      const current = autoReplies.find((a) => a.account === account);
      if (!current) return;
      try {
        const res = await mailApiFetch("/api/mail/autoreply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...current, enabled: false }),
        });
        const json = (await res.json()) as {
          autoReply?: AutoReplyDto;
          error?: string;
        };
        if (!res.ok || !json.autoReply) {
          throw new Error(json.error || "Couldn't end the auto-reply");
        }
        storeAutoReply(json.autoReply);
        toast.success(`Out-of-office reply ended for ${account}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't end the auto-reply"
        );
      }
    },
    [autoReplies, storeAutoReply]
  );

  // Auto-reply is optional chrome (banner + accounts menu). Defer so we don't
  // compete with the inbox's Gmail traffic and trip concurrent-request 429s.
  React.useEffect(() => {
    // Not gated on the AI flavor. Reading and setting an out-of-office is a
    // plain provider setting; only the button that writes the message for you
    // needs a key, and that one is gated where it lives. Gating this hid the
    // whole feature on the standalone for a day.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await mailApiFetch("/api/mail/autoreply");
          const json = (await res.json()) as { autoReplies?: AutoReplyDto[] };
          if (!cancelled && res.ok && json.autoReplies) {
            setAutoReplies(json.autoReplies);
          }
        } catch {
          // Badge is best-effort; the dialog surfaces errors when opened.
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  /** Open the dialog on one mailbox (Set up…, Edit, Manage). */
  const openAutoReply = React.useCallback((account: string) => {
    setAutoReplyAccount(account);
    setAutoReplyOpen(true);
  }, []);
  const closeAutoReply = React.useCallback(() => setAutoReplyOpen(false), []);

  return {
    autoReplies,
    autoReplyByAccount,
    autoReplyOpen,
    autoReplyAccount,
    openAutoReply,
    closeAutoReply,
    storeAutoReply,
    endAutoReply,
  };
}
