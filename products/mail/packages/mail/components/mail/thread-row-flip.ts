"use client";


const PIN_FLIP_MS = 400;
const PIN_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function readThreadRowRects(root: ParentNode | null): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  if (!root) return map;
  root.querySelectorAll<HTMLElement>("[data-thread-key]").forEach((el) => {
    const key = el.dataset.threadKey;
    if (key) map.set(key, el.getBoundingClientRect());
  });
  return map;
}

/** FLIP rows after pin/unpin so the moved thread glides instead of jumping. */
export function playThreadRowFlip(
  root: ParentNode | null,
  from: Map<string, DOMRect>,
  focusKey?: string | null
): void {
  if (!root || from.size === 0) return;
  root.querySelectorAll<HTMLElement>("[data-thread-key]").forEach((el) => {
    const key = el.dataset.threadKey;
    if (!key) return;
    const first = from.get(key);
    const last = el.getBoundingClientRect();
    if (!first) {
      if (focusKey && key === focusKey) {
        el.animate(
          [
            { opacity: 0.55, transform: "translateY(10px) scale(0.98)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: PIN_FLIP_MS, easing: PIN_FLIP_EASING }
        );
      }
      return;
    }
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const isFocus = focusKey === key;
    el.style.zIndex = isFocus ? "5" : "1";
    const anim = el.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)${isFocus ? " scale(1.02)" : ""}`,
          boxShadow: isFocus
            ? "0 10px 28px rgba(28, 25, 23, 0.14)"
            : "0 0 0 transparent",
        },
        {
          transform: "translate(0, 0) scale(1)",
          boxShadow: "0 0 0 transparent",
        },
      ],
      { duration: PIN_FLIP_MS, easing: PIN_FLIP_EASING }
    );
    anim.finished.then(
      () => {
        el.style.zIndex = "";
      },
      () => {
        el.style.zIndex = "";
      }
    );
  });
}
