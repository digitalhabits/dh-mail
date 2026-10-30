"use client";

/**
 * A right-click on the background of a part of the window (top bar, folder
 * list, mail list, its header, behind a thread) opens a small card to set
 * that part's colour, the same picker as Settings > General > Colours.
 *
 * Only on background. A right-click that something else already answered
 * (a row's menu, an address's menu) is left to it, and so is one on a
 * message, text, a link, a field or a button, or with text selected: there
 * the system's own menu is the useful one. Light theme only, as the
 * colours are.
 */

import * as React from "react";
import { createPortal } from "react-dom";

import { SURFACE_LABEL, SurfaceColorPicker } from "@/components/mail/surface-color-picker";
import { useMailT } from "@/lib/mail/i18n";
import { surfaceAt } from "@/lib/mail/surface-colors";
import type { Surface } from "@/lib/mail/surface-colors";

const CARD_W = 280;
const CARD_H = 92;

type Open = { surface: Surface; x: number; y: number };

export function useSurfaceColorMenu(): React.ReactNode {
  const [open, setOpen] = React.useState<Open | null>(null);
  React.useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (window.getSelection()?.toString()) return;
      const surface = surfaceAt(e.target);
      if (!surface) return;
      e.preventDefault();
      setOpen({ surface, x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
  if (!open) return null;
  return <SurfaceColorCard open={open} onClose={() => setOpen(null)} />;
}

function SurfaceColorCard({ open, onClose }: { open: Open; onClose: () => void }) {
  const t = useMailT();
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // Kept inside the window, as a menu is.
  const left = Math.max(8, Math.min(open.x, window.innerWidth - CARD_W - 8));
  const top = Math.max(8, Math.min(open.y, window.innerHeight - CARD_H - 8));
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t("colourMenuTitle", { part: t(SURFACE_LABEL[open.surface]) })}
      data-surface-color-menu={open.surface}
      className="fixed z-[200] rounded-surface border border-[rgba(27,61,74,0.08)] bg-white p-3 text-[#1b3d4a] shadow-[0_18px_36px_rgba(27,61,74,0.14)]"
      style={{ left, top, width: CARD_W }}
    >
      <p className="mb-2 text-xs font-semibold">
        {t("colourMenuTitle", { part: t(SURFACE_LABEL[open.surface]) })}
      </p>
      <SurfaceColorPicker surface={open.surface} />
    </div>,
    document.body
  );
}
