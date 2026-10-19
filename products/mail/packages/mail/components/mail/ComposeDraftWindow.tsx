"use client";

/**
 * A new message in an ordinary window of its own — a double-click on it in
 * Drafts (see openMailDraftWindow).
 *
 * The window holds the same composer the main window writes in, opened on
 * the stored draft by its key. Closing or discarding it closes the window.
 *
 * Send is the one ending that does not close the window at once. The mail
 * leaves when the Undo count runs out, and the count runs in this window: a
 * window closed inside it could take the mail with it. So the window waits,
 * says it is sending, and closes when the mail is away. Undo puts the
 * composer back. A send that fails stays on screen with its Retry.
 */

import * as React from "react";

import { ComposeView } from "@/components/mail/ComposeView";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { useMailT } from "@/lib/mail/i18n";
import { signalPopoutSend } from "@/lib/mail/popout";
import { useMailColorMode } from "@/lib/mail/theme";
import { closeMailReaderWindow, isNativeShell } from "@/lib/native-shell";

function closeSelf(): void {
  if (isNativeShell()) {
    void closeMailReaderWindow().catch(() => window.close());
    return;
  }
  window.close();
}

export function ComposeDraftWindow({
  draftKey,
  accounts,
  subject,
}: {
  draftKey: string;
  /** Every connected mailbox, for the From picker. */
  accounts: string[];
  subject: string;
}) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  const [zoom, adjustZoom] = useMailZoom();
  // Set by Send just before the composer closes, so that close is a wait.
  const sendingRef = React.useRef(false);
  const [sending, setSending] = React.useState(false);
  // A new composer after Undo: the old one has unmounted.
  const [round, setRound] = React.useState(0);

  /** The window's own title, for the browser popup; the shell sets its own. */
  React.useEffect(() => {
    document.title = subject || t("newEmail");
  }, [subject, t]);

  return (
    <div
      className="mail-shell mail-surface-root fixed inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mail-thread-bg,#fff)]"
      data-theme={colorMode}
    >
      {sending ? (
        <p className="m-auto text-sm text-stone-500">{t("sending")}</p>
      ) : (
        <ComposeView
          key={`${draftKey}|${round}`}
          accounts={accounts}
          zoom={zoom}
          onZoomAdjust={adjustZoom}
          // There is no list in this window to put away.
          focusMode={false}
          onSending={() => {
            sendingRef.current = true;
          }}
          onClose={() => {
            if (sendingRef.current) {
              setSending(true);
              return;
            }
            // Closed or discarded. The main window's Drafts list reads the
            // store again when that window comes forward.
            closeSelf();
          }}
          onSent={(accountEmail) => {
            signalPopoutSend(accountEmail, "");
            closeSelf();
          }}
          onUndoSend={() => {
            sendingRef.current = false;
            setSending(false);
            setRound((n) => n + 1);
          }}
          seed={{ to: [], subject: "", continuedFromLabel: "", draftKey }}
        />
      )}
    </div>
  );
}
