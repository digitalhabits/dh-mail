"use client";

/**
 * The right-click menu of a row in the Outbox group at the top of the
 * list. It gave the browser's own menu (Look Up, Translate, Copy), which
 * can do nothing to the message.
 *
 * Open, and the same ways out the thread offers under the message: Send
 * now (Try again for one the server refused) and Cancel. A message the
 * server has and cannot give back (17.1 of docs/mail-exchange-ews.md) says
 * so instead of offering them. Edit is in the thread, which Open shows.
 */

import * as React from "react";
import { Ban, MailOpen, Send } from "lucide-react";

import { MENU_ICON, MENU_ITEM, MenuShell } from "@/components/mail/MenuShell";
import { useMailT } from "@/lib/mail/i18n";
import type { MailScheduledMessage } from "@/lib/mail/types";

export type OutboxMenuAt = { held: MailScheduledMessage; x: number; y: number };

export function OutboxRowMenu({
  at,
  onOpen,
  onAct,
  onDismiss,
}: {
  at: OutboxMenuAt;
  onOpen: (held: MailScheduledMessage) => void;
  onAct: (held: MailScheduledMessage, action: "sendNow" | "cancel") => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const { held } = at;
  const firstRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => firstRef.current?.focus(), []);
  const run = (work: () => void) => () => {
    onDismiss();
    work();
  };
  const canAct = held.cancellable !== false;
  return (
    <MenuShell x={at.x} y={at.y} label={held.subject || t("outbox")} onDismiss={onDismiss}>
      <button ref={firstRef} type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => onOpen(held))}>
        <MailOpen className={MENU_ICON} aria-hidden />
        {t("open")}
      </button>
      {canAct ? (
        <>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => onAct(held, "sendNow"))}>
            <Send className={MENU_ICON} aria-hidden />
            {held.status === "failed" ? t("tryAgain") : t("sendNow")}
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => onAct(held, "cancel"))}>
            <Ban className={MENU_ICON} aria-hidden />
            {t("cancel")}
          </button>
        </>
      ) : (
        <p className="max-w-[16rem] px-3 py-1.5 text-xs leading-snug text-stone-500">{t("heldCannotCancel")}</p>
      )}
    </MenuShell>
  );
}
