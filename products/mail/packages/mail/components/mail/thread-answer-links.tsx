"use client";

/**
 * A line in the thread that opens the other half of a split conversation.
 *
 * The reader answered from a mailbox that is not connected, and the provider
 * filed the reply apart from the mail it answers (lib/mail/answer-links.ts).
 * Above the reply: what it answers. Under the mail: the reply. Each opens
 * the other thread. Nothing is joined, so no action reaches the other one.
 */

import * as React from "react";
import { CornerDownRight, CornerUpLeft } from "lucide-react";

import { mailApiJson } from "@/lib/mail/api";
import { shortDate } from "@/lib/mail/date-format";
import type { MailT } from "@/lib/mail/i18n-strings";
import type { MailAnswerLink } from "@/lib/mail/store/types";

/** Asks the page to open a thread: `detail` is `{ account, threadId }`. */
export const MAIL_OPEN_THREAD_EVENT = "dh-mail-open-thread";

/**
 * Opens a thread when a link asks for it. The page calls this with what
 * opening a row sets, so the thread opens as a row would.
 */
export function useOpenThreadEvent(open: (thread: { account: string; threadId: string }) => void) {
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  });
  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ account?: string; threadId?: string }>).detail;
      if (detail?.account && detail.threadId) openRef.current({ account: detail.account, threadId: detail.threadId });
    };
    window.addEventListener(MAIL_OPEN_THREAD_EVENT, onOpen);
    return () => window.removeEventListener(MAIL_OPEN_THREAD_EVENT, onOpen);
  }, []);
}

const linksByKey = new Map<string, MailAnswerLink[]>();

/** The links for this thread, read again when its newest message changes. */
export function useAnswerLinks(account: string, threadId: string, newestId: string | undefined): MailAnswerLink[] {
  const key = `${account}|${threadId}|${newestId ?? ""}`;
  const [links, setLinks] = React.useState<{ key: string; links: MailAnswerLink[] } | null>(null);
  const kept = linksByKey.get(key);
  React.useEffect(() => {
    if (!account || !threadId || linksByKey.has(key)) return;
    let live = true;
    const params = new URLSearchParams({ account, id: threadId });
    mailApiJson<{ links: MailAnswerLink[] }>(`/api/mail/answer-links?${params.toString()}`)
      .then((json) => {
        // An answer without a list, from an older shell, is no links.
        const found = Array.isArray(json?.links) ? json.links : [];
        linksByKey.set(key, found);
        if (live) setLinks({ key, links: found });
      })
      .catch(() => {
        /* no link: the thread reads as it did */
      });
    return () => {
      live = false;
    };
  }, [account, threadId, key]);
  return kept ?? (links?.key === key ? links.links : []);
}

export function AnswerLinkLines({
  account,
  links,
  t,
}: {
  account: string;
  links: MailAnswerLink[];
  t: MailT;
}) {
  if (!links.length) return null;
  return (
    <>
      {links.map((link) => {
        const date = shortDate(new Date(link.sentAt).toISOString());
        const answers = link.direction === "answers";
        const Icon = answers ? CornerUpLeft : CornerDownRight;
        return (
          <p key={`${link.direction}-${link.threadId}`} className="flex items-center justify-center gap-1.5 text-[12px] text-[var(--mail-thread-muted)]">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              {answers
                ? t("answerLinkAnswers", { name: link.fromName || link.fromEmail, date })
                : t("answerLinkAnsweredBy", { address: link.fromEmail, date })}
            </span>
            <button
              type="button"
              className="shrink-0 font-medium text-[var(--mail-thread-fg)] underline-offset-2 hover:underline"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(MAIL_OPEN_THREAD_EVENT, { detail: { account, threadId: link.threadId } })
                )
              }
            >
              {t("answerLinkOpen")}
            </button>
          </p>
        );
      })}
    </>
  );
}
