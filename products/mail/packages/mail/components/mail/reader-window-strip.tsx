"use client";

/**
 * The top of a window that a conversation, a person's mail or a new message
 * pops out into: the Mac's traffic lights sit in it, as in the main window,
 * and its empty parts drag the window.
 *
 * Those windows had the Mac's own grey title bar over the page (Ulrik,
 * 2026-11-05). They now draw their page up to the top edge, with the
 * buttons over it (popout.rs, `open_mail_reader_window`), so the page keeps
 * this strip clear for them. 44px, as the main window's title strip.
 *
 * `overlay` lies over the top of the page instead of pushing it down: the
 * new message has empty room there already. Nothing on Windows, where the
 * window keeps its own title bar, or outside the app.
 */

import * as React from "react";

import { isWindowsHost } from "@/lib/mail/host-os";
import { isNativeShell } from "@/lib/native-shell";
import { cn } from "@/lib/utils";

/** Whether this window draws its own top: the Mac app only. */
export function useOwnWindowTop(): boolean {
  const [own, setOwn] = React.useState(false);
  React.useEffect(() => setOwn(isNativeShell() && !isWindowsHost()), []);
  return own;
}

export function ReaderWindowStrip({
  overlay = false,
  children,
}: {
  overlay?: boolean;
  /** After the traffic lights: a way back, for example. */
  children?: React.ReactNode;
}) {
  if (!useOwnWindowTop()) return null;
  return (
    <div
      data-tauri-drag-region="deep"
      data-reader-window-strip
      className={cn(
        "mail-reader-topbar flex h-11 shrink-0 items-center",
        overlay ? "absolute inset-x-0 top-0 z-20" : "bg-[var(--mail-thread)]"
      )}
    >
      {children}
    </div>
  );
}
