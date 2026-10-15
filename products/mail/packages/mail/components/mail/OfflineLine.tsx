import { ListNotice } from "@/components/mail/ListNotice";
import type { MailT } from "@/lib/mail/i18n-strings";
import type { OfflineKind } from "@/lib/mail/use-offline";

/**
 * One line above the list while Mail is offline: what is wrong, that what
 * the reader does is kept, and how much waits to be sent.
 *
 * It stands in for the line each mailbox gave when its sync stopped on the
 * network. Those came one per mailbox, only after a sync had failed, and
 * did not say that an archive or a read made meanwhile was kept. A tester
 * offline took a missing answer for a lost action (2026-10-15).
 */
export function OfflineLine({ offline, waiting, t }: { offline: OfflineKind; waiting: number; t: MailT }) {
  if (!offline) return null;
  return (
    <div className="border-b border-[var(--mail-chrome-border)] px-5 pb-2.5 pt-2.5" data-offline-line>
      <ListNotice kind="offline" title={t(offline === "browser" ? "offlineTitle" : "offlineServersTitle")}>
        <p>{t("offlineHelp")}</p>
        {waiting > 0 ? (
          <p className="mt-0.5">{waiting === 1 ? t("offlineWaitingOne") : t("offlineWaitingMany", { count: waiting })}</p>
        ) : null}
      </ListNotice>
    </div>
  );
}
