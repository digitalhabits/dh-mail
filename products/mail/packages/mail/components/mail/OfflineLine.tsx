import { ListNotice } from "@/components/mail/ListNotice";
import type { MailT } from "@/lib/mail/i18n-strings";
import type { OfflineKind } from "@/lib/mail/use-offline";

/**
 * One line above the list while Mail is offline: what is wrong, that what
 * the reader does is kept, and how much waits to be sent.
 *
 * One line, and not a line for each mailbox when its sync stops on the
 * network. Those come only after a sync fails, and do not say that an
 * archive or a read made meanwhile is kept. Then a reader who is offline
 * takes a missing answer for a lost action.
 */
export function OfflineLine({ offline, waiting, t }: { offline: OfflineKind; waiting: number; t: MailT }) {
  if (!offline) return null;
  return (
    <div className="px-5 pb-2.5 pt-2.5" data-offline-line>
      <ListNotice kind="offline" title={t(offline === "browser" ? "offlineTitle" : "offlineServersTitle")}>
        <p>{t("offlineHelp")}</p>
        {waiting > 0 ? (
          <p className="mt-0.5">{waiting === 1 ? t("offlineWaitingOne") : t("offlineWaitingMany", { count: waiting })}</p>
        ) : null}
      </ListNotice>
    </div>
  );
}
