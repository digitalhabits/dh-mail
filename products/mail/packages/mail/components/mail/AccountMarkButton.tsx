"use client";

/**
 * The picture on a mailbox, and the way to change it.
 *
 * Two places show a mailbox with its mark: the row of tabs over the list,
 * and the list of accounts in Settings. Both should let the reader put
 * their own picture on it — a Google Workspace address at your own company
 * is a Google account the way a phone bill is a phone, true and not what it
 * is for — so the mark, the menu it opens and the scaling behind it live
 * here rather than in whichever surface happened to need them first.
 */

import * as React from "react";
import type { MailProvider } from "@/lib/mail/types";
import { EyeOff, Image as ImageIcon, RotateCcw } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { AccountMark } from "@/components/mail/AccountMark";
import {
  ACCOUNT_MARK_MAX_EDGE,
  setAccountMark,
  useAccountMarks,
} from "@/lib/mail/account-mark";
import { useMailT } from "@/lib/mail/i18n";
import { POINTER_MENU_ICON, POINTER_MENU_ITEM, PointerMenu } from "@/components/mail/PointerMenu";
import { downscaleTarget } from "@/lib/mail/rest-image";
import { cn } from "@/lib/utils";

/** Scale a chosen picture down to a mark and hand it back as a data URL. */
export async function fileToMark(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not a picture"));
      element.src = url;
    });
    const target = downscaleTarget(
      image.naturalWidth,
      image.naturalHeight,
      ACCOUNT_MARK_MAX_EDGE
    );
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read that picture");
    context.drawImage(image, 0, 0, target.width, target.height);
    // PNG: a logo has flat colour and hard edges, which JPEG smears.
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The right-click menu on a mailbox tab. Placed at the pointer. */
export function MarkMenu({
  x,
  y,
  hasOwnMark,
  onChoose,
  onReset,
  onHide,
  onDismiss,
}: {
  x: number;
  y: number;
  hasOwnMark: boolean;
  onChoose: () => void;
  onReset: () => void;
  /** Hide the mailbox from Mail. Absent where hiding is not offered. */
  onHide?: () => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  return (
    <PointerMenu x={x} y={y} onDismiss={onDismiss}>
      {/* Hiding first: it is the bigger thing the menu does. */}
      {onHide ? (
        <>
          <button type="button" role="menuitem" autoFocus className={POINTER_MENU_ITEM} onClick={onHide}>
            <EyeOff className={POINTER_MENU_ICON} aria-hidden />
            {t("hideMailbox")}
          </button>
          <div className="my-1 h-px bg-stone-100" role="separator" />
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        autoFocus={!onHide}
        className={POINTER_MENU_ITEM}
        onClick={onChoose}
      >
        <ImageIcon className={POINTER_MENU_ICON} aria-hidden />
        {t("chooseAPicture")}
      </button>
      {hasOwnMark ? (
        <button type="button" role="menuitem" className={POINTER_MENU_ITEM} onClick={onReset}>
          <RotateCcw className={POINTER_MENU_ICON} aria-hidden />
          {t("useProviderMark")}
        </button>
      ) : null}
    </PointerMenu>
  );
}
/**
 * A mailbox's mark, as a button that changes it.
 *
 * Click for the menu — choose a picture, or go back to the provider's. The
 * tabs open the same menu on a right-click, because a left-click there
 * chooses the mailbox; in Settings there is nothing else the mark could
 * mean, so the plain click does it.
 */
export function AccountMarkButton({
  account,
  provider,
  className,
  markClassName,
  title,
}: {
  account: string;
  provider: MailProvider | "unknown";
  className?: string;
  markClassName?: string;
  title?: string;
}) {
  const marks = useAccountMarks();
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const key = account.trim().toLowerCase();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAccountMark(account, await fileToMark(file));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not read that picture"
      );
    }
  };

  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        className={cn(
          "shrink-0 rounded transition-opacity hover:opacity-80",
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          const box = e.currentTarget.getBoundingClientRect();
          setMenu({ x: box.left, y: box.bottom + 4 });
        }}
        // The row in Settings is a drag handle; a press on the mark is for
        // the mark, and must not start moving the mailbox instead.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <AccountMark
          mark={marks[key]}
          provider={provider}
          className={markClassName}
        />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
      {menu ? (
        <MarkMenu
          x={menu.x}
          y={menu.y}
          hasOwnMark={Boolean(marks[key])}
          onChoose={() => {
            setMenu(null);
            fileRef.current?.click();
          }}
          onReset={() => {
            setAccountMark(account, null);
            setMenu(null);
          }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}
