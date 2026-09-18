import * as React from "react";
import { AlertTriangle, WifiOff } from "lucide-react";

/**
 * A notice above the thread list: a mailbox that cannot be reached, a sync
 * that stopped, a permission that ran out.
 *
 * These were bare lines of amber text, and a reader said they looked like
 * something internal that had leaked onto the page. This is the same notice
 * in the app's own dress: a quiet card in the list's colours, an icon that
 * says what kind of trouble it is, the fact in the text colour and the help
 * under it in the muted one. Amber is kept for the icon and a thin edge, so
 * it still reads as "look at this" without shouting.
 */
export function ListNotice({
  kind = "warning",
  title,
  children,
  action,
}: {
  kind?: "offline" | "warning";
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = kind === "offline" ? WifiOff : AlertTriangle;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-amber-600/25 bg-amber-500/[0.07] px-3 py-2.5"
    >
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 text-[12px] leading-snug">
        <p className="break-words font-semibold text-[var(--mail-chrome-fg)]">{title}</p>
        {children ? (
          <div className="mt-0.5 text-[var(--mail-chrome-muted)]">{children}</div>
        ) : null}
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}

/** The one button a notice can carry, as the list's other text buttons look. */
export function ListNoticeButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] font-semibold text-[var(--mail-chrome-fg)] underline decoration-[var(--mail-chrome-border)] underline-offset-2 hover:decoration-current"
    >
      {children}
    </button>
  );
}
