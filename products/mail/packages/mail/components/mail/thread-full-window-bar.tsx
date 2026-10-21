"use client";

/**
 * The quiet bar over the thread in the whole window (see
 * thread-full-window): the way back to a person's threads on the left, the
 * subject in the middle, and on the right Archive, Delete, "…" with the
 * rest of the toolbar, the text size and Exit reader. Reply is in the
 * reply tray at the foot of the thread.
 *
 * It stands where the window's title bar is, so the empty parts drag the
 * window, and it keeps clear of the Mac's traffic lights and of the window
 * buttons on Windows (`.mail-reader-topbar` in mail.css).
 */

import { fitTitle, type TitleFit } from "@/components/mail/title-fit";
import * as React from "react";
import { Archive, Minimize2, Trash2 } from "lucide-react";

import { ReaderTextSize } from "@/components/mail/MessageReader";
import { ThreadAction } from "@/components/mail/ThreadAction";
import { useMailT } from "@/lib/mail/i18n";

/** The subject's size in the bar: measured against the 48vw it may take. */
function useBarTitleFit(title: string): TitleFit {
  const [room, setRoom] = React.useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth * 0.48
  );
  React.useEffect(() => {
    const read = () => setRoom(window.innerWidth * 0.48);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  // Two lines do not fit the bar: the smallest size, cut off at its end.
  return React.useMemo(() => (room > 0 ? fitTitle(title, room) : { size: 26, lines: 1 }), [title, room]);
}

export function ThreadFullWindowBar({
  lead,
  title,
  more,
  onArchive,
  onTrash,
  onExit,
}: {
  lead?: React.ReactNode;
  title: string;
  /** The "…" menu. */
  more?: React.ReactNode;
  onArchive?: () => void;
  onTrash?: () => void;
  onExit: () => void;
}) {
  const t = useMailT();
  const fit = useBarTitleFit(title);
  return (
    <div
      data-tauri-drag-region="deep"
      data-thread-full-window-bar
      className="mail-reader-topbar grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread)]"
      style={{ paddingRight: "var(--mail-titlebar-right, 1.25rem)" }}
    >
      <div className="flex min-w-0 items-center">{lead}</div>
      {/* As the thread's own header sets the subject: Georgia, bold, 26px
          when it fits, then 20 and 17px (title-fit). One line here. */}
      <h2
        className="max-w-[48vw] truncate text-center font-serif !font-bold text-[var(--mail-thread-fg)]"
        style={{ fontSize: fit.size, lineHeight: 1.25 }}
      >
        {title}
      </h2>
      <div className="flex min-w-0 items-center justify-end gap-1">
        {onArchive ? <ThreadAction label={t("actionArchive")} icon={Archive} onClick={onArchive} /> : null}
        {onTrash ? <ThreadAction label={t("actionDelete")} icon={Trash2} onClick={onTrash} /> : null}
        {more}
        <ReaderTextSize />
        <button
          type="button"
          data-thread-full-window-exit
          // Esc still leaves; the key is said on hover, not on the button.
          title={`${t("readerExit")} (Esc)`}
          onClick={onExit}
          className="ml-1 flex items-center gap-2 rounded-control border border-[var(--mail-nav-tint-border)] bg-[var(--mail-nav-tint)] px-3 py-1.5 text-sm text-[var(--mail-thread-fg)] hover:bg-[var(--mail-chrome-hover)]"
        >
          <Minimize2 className="h-3.5 w-3.5 text-[var(--mail-thread-muted)]" aria-hidden />
          <span>{t("readerExit")}</span>
        </button>
      </div>
    </div>
  );
}
