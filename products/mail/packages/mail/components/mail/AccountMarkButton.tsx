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
import { EyeOff, Image as ImageIcon, Pencil, RotateCcw } from "lucide-react";
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
 * Picking a picture file for a mailbox: a hidden file field, and a way to
 * open it. The mark button and "Choose a picture" in the setup dialog use it.
 */
function usePictureFile(account: string) {
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAccountMark(account, await fileToMark(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that picture");
    }
  };
  const input = (
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
  );
  return { input, choose: () => fileRef.current?.click() };
}

/** "Choose a picture": opens the file picker at once. For the setup dialog. */
export function ChoosePictureLink({ account, className }: { account: string; className?: string }) {
  const t = useMailT();
  const file = usePictureFile(account);
  return (
    <>
      <button type="button" className={cn("text-teal-700 hover:underline", className)} onClick={file.choose}>
        {t("chooseAPicture")}
      </button>
      {file.input}
    </>
  );
}

/**
 * A mailbox's mark, as a button that changes it.
 *
 * Click for the menu — choose a picture, or go back to the provider's. The
 * tab's menu does not offer it (2026-10-20): the picture is set in Settings
 * and when the mailbox is connected.
 *
 * `large`: a tile with a pencil on its corner, as in Settings and the setup
 * dialog, so the mark reads as something that can be changed.
 */
export function AccountMarkButton({
  account,
  provider,
  className,
  markClassName,
  title,
  large = false,
}: {
  account: string;
  provider: MailProvider | "unknown";
  className?: string;
  markClassName?: string;
  title?: string;
  large?: boolean;
}) {
  const marks = useAccountMarks();
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const file = usePictureFile(account);
  const key = account.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        className={cn(
          "shrink-0 transition-opacity hover:opacity-80",
          large ? "relative flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100" : "rounded",
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
          className={large ? (marks[key] ? "h-10 w-10 rounded-xl" : "h-6 w-6") : markClassName}
        />
        {large ? (
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[var(--mail-chrome)] bg-stone-600 text-white"
          >
            <Pencil className="h-2.5 w-2.5" />
          </span>
        ) : null}
      </button>
      {file.input}
      {menu ? (
        <MarkMenu
          x={menu.x}
          y={menu.y}
          hasOwnMark={Boolean(marks[key])}
          onChoose={() => {
            setMenu(null);
            file.choose();
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
