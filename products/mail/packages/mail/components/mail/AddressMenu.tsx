"use client";

/**
 * What a right-click on an address offers: copy it, or write to it.
 *
 * The same two things a right-click on a mailto link in a message offers,
 * for the addresses the interface itself shows — the people on a thread's
 * header, the chips in a To field, the names in a reply's "Replying to"
 * line. Without it the system menu came up, which knows the words but not
 * that they are an address.
 */

import * as React from "react";
import { Copy, Mail } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { MENU_ICON, MENU_ITEM, MenuShell } from "@/components/mail/MenuShell";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import {
  recipientKey,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import { mailSay, useMailT } from "@/lib/mail/i18n";

export type AddressMenuAt = {
  x: number;
  y: number;
  email: string;
  name?: string;
};

export function AddressContextMenu({
  at,
  onDismiss,
}: {
  at: AddressMenuAt;
  onDismiss: () => void;
}) {
  const t = useMailT();
  return (
    <MenuShell x={at.x} y={at.y} label={at.email} onDismiss={onDismiss}>
      {/* The address itself first, to be read: the line that was clicked
          may have shown a name. */}
      <div
        className="max-w-[min(24rem,calc(100vw-1rem))] truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={at.email}
      >
        {at.name && at.name !== at.email ? `${at.name} · ${at.email}` : at.email}
      </div>
      <div className="mb-1 border-t border-stone-200" />
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          onDismiss();
          void copyTextToClipboard(at.email).then((ok) =>
            ok
              ? toast.success(mailSay("copied"))
              : toast.error(mailSay("couldNotCopy"))
          );
        }}
      >
        <Copy className={MENU_ICON} aria-hidden />
        {t("copyAddress")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          onDismiss();
          requestMailComposeTo(at.email);
        }}
      >
        <Mail className={MENU_ICON} aria-hidden />
        {t("sendEmail")}
      </button>
    </MenuShell>
  );
}

/**
 * The menu's state, for whatever shows addresses: `openAddressMenu` goes on
 * the element's onContextMenu, and `addressMenu` goes in the output.
 */
export function useAddressMenu(): {
  openAddressMenu: (e: React.MouseEvent, email: string, name?: string) => void;
  addressMenu: React.ReactNode;
} {
  const [at, setAt] = React.useState<AddressMenuAt | null>(null);
  const openAddressMenu = React.useCallback(
    (e: React.MouseEvent, email: string, name?: string) => {
      const address = email.trim();
      if (!address) return;
      e.preventDefault();
      e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY, email: address, name });
    },
    []
  );
  const dismiss = React.useCallback(() => setAt(null), []);
  const addressMenu = at ? (
    <AddressContextMenu at={at} onDismiss={dismiss} />
  ) : null;
  return { openAddressMenu, addressMenu };
}

/**
 * Recipients written out as a sentence — "Ada Lovelace, Grace Hopper" —
 * each address answering a right-click. A saved list is named with its
 * count, as formatRecipientSummary writes it, and offers no menu: it is
 * not one address.
 */
export function RecipientSummary({
  recipients,
  onAddressMenu,
}: {
  recipients: MailRecipient[];
  onAddressMenu: (e: React.MouseEvent, email: string, name?: string) => void;
}) {
  return (
    <>
      {recipients.map((r, i) => (
        <React.Fragment key={recipientKey(r)}>
          {i > 0 ? ", " : null}
          {r.kind === "email" ? (
            <span onContextMenu={(e) => onAddressMenu(e, r.email, r.name)}>
              {r.name || r.email}
            </span>
          ) : (
            `${r.name} (${r.members.length})`
          )}
        </React.Fragment>
      ))}
    </>
  );
}
