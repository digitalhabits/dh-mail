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
import { createPortal } from "react-dom";
import { Image as ImageIcon, RotateCcw } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { AccountMark } from "@/components/mail/AccountMark";
import {
  ACCOUNT_MARK_MAX_EDGE,
  setAccountMark,
  useAccountMarks,
} from "@/lib/mail/account-mark";
import { useMailT } from "@/lib/mail/i18n";
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
  onDismiss,
}: {
  x: number;
  y: number;
  hasOwnMark: boolean;
  onChoose: () => void;
  onReset: () => void;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";
  const icon = "h-3.5 w-3.5 shrink-0 text-stone-400";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      /* Named, so a Radix popover this menu opens over can tell that a
         press landing here is not a press outside itself — the settings
         panel is one, and it was closing under the pointer before the
         click could land. See MailPage's settings content. */
      data-mail-mark-menu=""
      /*
        `pointerEvents` because a Radix popover turns them off for
        everything outside its own content while it is open, and this menu
        hangs on <body> beside it rather than inside it. It was drawn, and
        it was not clickable: the presses went nowhere.
      */
      style={{ left: placed.left, top: placed.top, pointerEvents: "auto" }}
      className="mail-light-surface fixed z-[70] w-max rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        autoFocus
        className={item}
        onClick={onChoose}
      >
        <ImageIcon className={icon} aria-hidden />
        {t("chooseAPicture")}
      </button>
      {hasOwnMark ? (
        <button type="button" role="menuitem" className={item} onClick={onReset}>
          <RotateCcw className={icon} aria-hidden />
          {t("useProviderMark")}
        </button>
      ) : null}
    </div>,
    document.body
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
