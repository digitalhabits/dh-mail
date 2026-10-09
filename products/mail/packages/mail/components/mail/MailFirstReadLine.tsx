import { ListNoticeButton } from "@/components/mail/ListNotice";
import type { FirstReadLine } from "@/lib/mail/first-read";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * The first read of a mailbox: a bar, the count, and the state in words.
 *
 * It shows for as long as the read is not complete, in every state and at
 * every width of the list. See `lib/mail/first-read.ts` for the rule. A read
 * that is not running has an amber bar, so a look tells the two apart, and the
 * words under it say why and what happens next.
 */
export function MailFirstReadLine({
  line,
  narrow,
  onReconnect,
}: {
  line: FirstReadLine;
  /** The list is the avatar column: the bar and a percent, the words on hover. */
  narrow: boolean;
  onReconnect: () => void;
}) {
  const t = useMailT();
  const share = Math.min(1, line.done / line.total);
  const percent = Math.floor(share * 100);
  const running = line.state === "reading";
  const label = t("syncReadingLabel", { account: line.account });
  const count = t("syncReadingCount", {
    done: line.done.toLocaleString(),
    total: line.total.toLocaleString(),
  });
  const stateText =
    line.state === "reading"
      ? t("firstReadReading")
      : line.state === "offline"
        ? t("firstReadOffline")
        : line.state === "signIn"
          ? t("firstReadSignIn")
          : line.state === "waiting"
            ? t("firstReadWaiting")
            : t("firstReadStopped");
  const bar = (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--mail-chrome-hover)]">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700",
          running ? "bg-teal-600" : "bg-amber-500"
        )}
        style={{ width: `${Math.max(1, Math.round(share * 100))}%` }}
      />
    </div>
  );
  if (narrow) {
    return (
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={line.total}
        aria-valuenow={line.done}
        aria-label={`${label}. ${count}. ${stateText}`}
        title={`${label}. ${count}. ${stateText}`}
        data-first-read={line.state}
        className="border-b border-[var(--mail-chrome-border)] px-1.5 pb-1.5 pt-2"
      >
        {bar}
        <p
          className={cn(
            "mt-1 text-center text-[10px] leading-tight tabular-nums",
            running ? "text-[var(--mail-chrome-muted)]" : "font-semibold text-amber-600"
          )}
        >
          {percent}%
        </p>
      </div>
    );
  }
  return (
    <div
      data-first-read={line.state}
      className="border-b border-[var(--mail-chrome-border)] px-5 pb-2.5 pt-2.5"
    >
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={line.total}
        aria-valuenow={line.done}
        aria-label={label}
      >
        <p className="flex items-baseline justify-between gap-3 text-[12px] leading-snug">
          <span className="min-w-0 truncate font-semibold text-[var(--mail-chrome-fg)]">{label}</span>
          <span className="shrink-0 tabular-nums text-[var(--mail-chrome-muted)]">{count}</span>
        </p>
        <div className="mt-1.5">{bar}</div>
      </div>
      <p
        role="status"
        className={cn(
          "mt-1.5 text-[12px] leading-snug",
          running ? "text-[var(--mail-chrome-muted)]" : "text-[var(--mail-chrome-fg)]"
        )}
      >
        {stateText}
      </p>
      {line.state === "signIn" ? (
        <div className="mt-1">
          <ListNoticeButton onClick={onReconnect}>{t("reconnect")}</ListNoticeButton>
        </div>
      ) : null}
      {line.reason && line.state !== "signIn" && line.state !== "offline" ? (
        <p className="mt-0.5 break-words text-[11px] text-[var(--mail-chrome-faint)]">
          {t("syncPausedDetails", { reason: line.reason })}
        </p>
      ) : null}
    </div>
  );
}
