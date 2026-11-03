"use client";

import * as React from "react";

/*
 * Settings as one page, as To-Do shows it (TodoSettingsModal): every
 * section on one scroll, and a sidebar that lists them. This hook keeps
 * which section is being read, goes to one on a press, and says whether
 * the page is wide enough for the sidebar.
 */

/** Narrower than this, the sections are one column and there is no sidebar. */
const SIDEBAR_FROM = 640;

export function useSettingsPage<Id extends string>(
  sections: readonly Id[],
  onClose: () => void,
  open: boolean
) {
  const pageRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(true);
  const [current, setCurrent] = React.useState<Id | undefined>(sections[0]);
  // The section last picked in the sidebar. At the page's foot, it stays
  // marked if it shows, rather than the last section.
  const pickedRef = React.useRef<Id | null>(null);
  const sectionsKey = sections.join(" ");

  // The page's width, as it changes.
  React.useLayoutEffect(() => {
    const el = pageRef.current;
    if (!open || !el) return;
    const measure = () => setWide(el.offsetWidth >= SIDEBAR_FROM);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // The section being read: the last whose heading reached the top.
  React.useEffect(() => {
    const box = scrollRef.current;
    if (!open || !box) return;
    const ids = sectionsKey.split(" ") as Id[];
    const find = (id: Id) =>
      box.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
    const onScroll = () => {
      const top = box.getBoundingClientRect().top + 48;
      let seen = ids[0];
      for (const id of ids) {
        const el = find(id);
        if (el && el.getBoundingClientRect().top <= top) seen = id;
      }
      // At the foot, a section whose heading never reaches the top is
      // still read: the one picked, if it shows, else the last.
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) {
        const picked = pickedRef.current;
        const pickedEl = picked ? find(picked) : null;
        const shows =
          pickedEl && pickedEl.getBoundingClientRect().top < box.getBoundingClientRect().bottom;
        seen = picked && shows ? picked : ids[ids.length - 1];
      }
      setCurrent(seen);
    };
    onScroll();
    // A scroll by the reader, not by a pick: the pick no longer holds.
    const forget = () => {
      pickedRef.current = null;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    box.addEventListener("wheel", forget, { passive: true });
    box.addEventListener("touchmove", forget, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      box.removeEventListener("wheel", forget);
      box.removeEventListener("touchmove", forget);
    };
  }, [open, sectionsKey]);

  // Escape goes back, as the back button does. These take Escape first:
  // - a menu, a list or a dialog that was open when the key went down,
  // - a form in the page that stops the key.
  React.useEffect(() => {
    if (!open) return;
    let taken = false;
    // Capture on the window runs before any menu shuts itself.
    const onKeyFirst = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      taken = Boolean(
        pageRef.current?.querySelector('[role="menu"], [role="listbox"]') ||
          document.querySelector('[role="dialog"][aria-modal="true"], [data-radix-popper-content-wrapper]')
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || taken) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyFirst, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKeyFirst, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const goTo = React.useCallback((id: Id, smooth = true) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
    if (!box || !el) return;
    const at = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    pickedRef.current = id;
    box.scrollTo({ top: Math.max(0, at - 24), behavior: smooth ? "smooth" : "auto" });
    setCurrent(id);
  }, []);

  return { pageRef, scrollRef, wide, current, goTo };
}
