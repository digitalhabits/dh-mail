"use client";

/**
 * "You forwarded this": a strip under the title of a thread, over the whole
 * conversation, and the arrow by the date of its row in the list.
 *
 * A forward is filed as a thread of its own, so the mail it was made from
 * showed nothing of it (Ulrik, 2026-11-17: as Outlook says "You forwarded
 * this message on …" with "Show Forward"). The strip names who it went to
 * and when, which Outlook does not, and "Show forward" opens the forward in a
 * window of its own. With several forwards it is about the newest.
 *
 * The store finds the forwards (forward_links.rs). Nothing is joined: an
 * action on either thread stays on that thread.
 */

import * as React from "react";
import { Forward, Reply } from "lucide-react";

import { mailApiJson } from "@/lib/mail/api";
import { SYNC_CHANGED_WINDOW_EVENT } from "@/lib/mail/local-store";
import { openMailThreadWindow } from "@/lib/mail/reader-window";
import { forwardedWords, rowMarkKind, stripLines } from "@/lib/mail/forward-words";
import { useMailT } from "@/lib/mail/i18n";
import type { MailForwardLink } from "@/lib/mail/store/types";

/** What was found last, so a thread opened again shows its strip at once. */
const linksByKey = new Map<string, MailForwardLink[]>();

/**
 * The forwards of this thread. Read when the thread opens, and again when
 * the store says that mail changed: a forward sent a moment ago is found
 * when its sent copy lands, with no reload (the first build kept the first
 * answer for good, and the strip came only after a reload, 2026-11-17).
 */
export function useForwardLinks(account: string, threadId: string): MailForwardLink[] {
  const key = `${account}|${threadId}`;
  const [found, setFound] = React.useState<{ key: string; links: MailForwardLink[] } | null>(null);
  React.useEffect(() => {
    if (!account || !threadId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const params = new URLSearchParams({ account, id: threadId });
      mailApiJson<{ links: MailForwardLink[] }>(`/api/mail/forward-links?${params.toString()}`)
        .then((json) => {
          // An answer without a list, from an older shell, is no forwards.
          const links = Array.isArray(json?.links) ? json.links : [];
          linksByKey.set(key, links);
          if (live) setFound({ key, links });
        })
        .catch(() => {
          /* no strip: the thread reads as it did */
        });
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 600);
    };
    read();
    window.addEventListener(SYNC_CHANGED_WINDOW_EVENT, soon);
    const unlisten: (() => void)[] = [];
    const tauriEvent = (window as unknown as {
      __TAURI__?: { event?: { listen: (name: string, cb: () => void) => Promise<() => void> } };
    }).__TAURI__?.event;
    for (const name of ["mail-sync-changed", "mail-sync-sent", "mail-sent"]) {
      void tauriEvent
        ?.listen(name, soon)
        .then((stop) => (live ? unlisten.push(stop) : stop()))
        .catch(() => undefined);
    }
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener(SYNC_CHANGED_WINDOW_EVENT, soon);
      for (const stop of unlisten) stop();
    };
  }, [account, threadId, key]);
  return found?.key === key ? found.links : (linksByKey.get(key) ?? []);
}

/** The strip under the title: one line for the newest forward, one for the newest reply under a new subject. */
export function ThreadForwardStrip({ account, threadId }: { account: string; threadId: string }) {
  const t = useMailT();
  const lines = stripLines(useForwardLinks(account, threadId));
  if (!lines.length) return null;
  return (
    <>
      {lines.map((link) => {
        const reply = link.kind === "reply";
        const Icon = reply ? Reply : Forward;
        const opens = link.threadId;
        return (
          <div
            key={`${link.kind ?? "forward"}-${link.sentAt}`}
            className="-ml-2 flex w-[calc(100%+0.5rem)] items-center gap-2 border-t border-[var(--mail-thread-rule,rgba(27,61,74,0.08))] bg-[var(--mail-forward-strip,rgba(27,61,74,0.06))] py-1.5 pl-10 pr-[14px] text-[12.5px] text-[var(--mail-thread-fg)]"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--mail-hours-accent)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {forwardedWords(link, t)}
              {reply && link.subject ? <span className="text-[var(--mail-thread-muted)]">{` · ${link.subject}`}</span> : null}
            </span>
            {opens ? (
              <button
                type="button"
                className="shrink-0 font-semibold underline-offset-2 hover:underline"
                onClick={() =>
                  // In a window of its own, as Outlook's "Show Forward" does.
                  // Opened in the reading pane, it stood beside a list that
                  // still showed the inbox with the first mail marked
                  // (2026-11-17).
                  void openMailThreadWindow({
                    account: link.account ?? account,
                    threadId: opens,
                    name: link.to[0]?.name ?? "",
                    email: link.to[0]?.email ?? "",
                    subject: link.subject ?? "",
                  }).catch(() => undefined)
                }
              >
                {t(reply ? "repliedApartShow" : "forwardedShow")}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** The arrow by the date of a list row: the thread was forwarded, or answered under a new subject. */
export function ForwardedRowMark({ forwardedAt, repliedApartAt }: { forwardedAt?: string; repliedApartAt?: string }) {
  const t = useMailT();
  const kind = rowMarkKind(forwardedAt, repliedApartAt);
  if (!kind) return null;
  const Icon = kind === "reply" ? Reply : Forward;
  const words = t(kind === "reply" ? "repliedApartRowMark" : "forwardedRowMark");
  return (
    <span title={words} aria-label={words} className="mr-1 inline-flex align-[-2px]">
      <Icon className="h-3 w-3 text-[var(--mail-hours-accent)]" aria-hidden />
    </span>
  );
}

/** The arrow of a person's row: that of their newest conversation. */
export function PersonForwardedMark({ threads }: { threads: { forwardedAt?: string; repliedApartAt?: string }[] }) {
  const newest = threads[0];
  return <ForwardedRowMark forwardedAt={newest?.forwardedAt} repliedApartAt={newest?.repliedApartAt} />;
}
