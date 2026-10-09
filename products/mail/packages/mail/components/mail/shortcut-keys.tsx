"use client";

/**
 * A key binding, drawn.
 *
 * `formatShortcut` writes the string a Mac writes — ⇧⌘R — and for a tooltip
 * that is the whole job. On screen it is not: the modifier glyphs are drawn
 * at different sizes by the fonts that carry them. ⌘ is about the height of a
 * capital letter, while ⇧ and ⌫ are drawn small, and in a monospace face they
 * fall back to whichever font on the machine has them at all. Beside a plain
 * R they then read as a smudge rather than a key.
 *
 * So the glyphs are drawn one at a time here: the small ones are scaled up to
 * stand with the letters, and the whole binding is set in the interface font,
 * which is the one that has all of them.
 */

import { formatShortcut, type MailShortcut } from "@/lib/mail/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The glyphs a font draws smaller than a capital letter.
 *
 * ⌘ is not among them — it is already the right size, and scaling it with the
 * others is what would make the set uneven.
 */
const SMALL_GLYPHS = new Set([
  "⇧", // shift
  "⌥", // option
  "⌃", // control
  "⌫", // delete
  "⎋", // escape
  "⇥", // tab
  "↩", // return
  "↑",
  "↓",
  "←",
  "→",
]);

export function ShortcutKeys({
  shortcut,
  className,
}: {
  shortcut: MailShortcut;
  className?: string;
}) {
  const text = formatShortcut(shortcut);
  return (
    <span
      // The binding reads as one word, so the glyphs sit tight together and
      // the whole of it is centred on the same line as the letters.
      className={cn("inline-flex items-baseline", className)}
      aria-label={text}
    >
      {[...text].map((glyph, index) =>
        SMALL_GLYPHS.has(glyph) ? (
          <span
            key={index}
            aria-hidden
            // Scaled to the height of the letters, and pulled back down: a
            // glyph made bigger grows from its baseline and would otherwise
            // stand a pixel proud of the row.
            className="relative top-[0.03em] text-[1.12em] leading-none"
          >
            {glyph}
          </span>
        ) : (
          <span key={index} aria-hidden>
            {glyph}
          </span>
        )
      )}
    </span>
  );
}
