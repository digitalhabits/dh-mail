/*
 * The two things a mail list row can say about itself, said two different
 * ways, so neither is taken for the other.
 *
 * Unread is a dot in a gutter of its own, left of the face, with the
 * sender and subject in bold: where Spark and Outlook put it. The open row
 * lifts off the list as a card. A teal bar down the open row's edge and a
 * small dot on the face looked too alike; a reader could not tell whether
 * the bar meant new mail (Mikkel, 2026-10-21).
 */

import { cn } from "@/lib/utils";

/**
 * The open row: a card standing a little in from the list's edges. Drawn
 * behind the row's contents (`isolate` keeps it inside the row), so the
 * row keeps its own size and the faces and words do not move when it opens.
 */
export const OPEN_ROW_CARD = cn(
  "isolate [--mail-person-stack-ring:var(--mail-row-selected-solid)]",
  "before:pointer-events-none before:absolute before:inset-x-2 before:inset-y-[2px] before:-z-10",
  "before:rounded-surface before:bg-[var(--mail-row-selected)] before:shadow-[var(--mail-row-card-shadow)]"
);

/**
 * The line under a row: an inset shadow, not a border, so the row keeps
 * its height and the list's measured rows do not move by a pixel each.
 * The open row's card is drawn over it.
 */
export const ROW_LINE = "shadow-[inset_0_-1px_0_var(--mail-row-line)]";

/** The row's left padding: room for the unread gutter before the face. */
export const ROW_PAD_LEFT = "pl-7";

/*
 * Where the dot stands: level with the middle of the face, as the new
 * Outlook puts it (Ulrik, 2026-10-21). From the row's top edge to the
 * dot's, in px: the row's padding, half the 36px face, less half the dot.
 */
/** A row padded 10px at the top (py-2.5): 10 + 18 - 4. */
export const FACE_DOT_TOP = 24;
/** The wide row, padded 8px (py-2): 8 + 18 - 4. */
export const WIDE_FACE_DOT_TOP = 22;

/**
 * The unread dot, in the gutter. `top` puts it level with the face of a
 * row whose contents start at the top; without it the dot is centred, for
 * a compact row, where the face is centred too.
 */
export function UnreadGutterDot({ unread, top }: { unread: boolean | undefined; top?: number }) {
  if (!unread) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-[10px] h-2 w-2 rounded-full bg-[var(--mail-accent)]",
        top == null && "top-1/2 -translate-y-1/2"
      )}
      style={top == null ? undefined : { top }}
    />
  );
}

/** Where the row has no gutter, and the unread dot stays on the face. */
export function dotOnFace(narrow: boolean | undefined, inCard: boolean | undefined): boolean {
  return Boolean(narrow || inCard);
}

/** The unread dot in the gutter, level with the face in each layout. */
export function RowUnreadDot({
  unread,
  narrow,
  inCard,
  compact,
  wide,
}: {
  unread: boolean | undefined;
  narrow: boolean | undefined;
  inCard: boolean | undefined;
  compact: boolean;
  wide: boolean | undefined;
}) {
  if (dotOnFace(narrow, inCard)) return null;
  const top = compact ? undefined : wide ? WIDE_FACE_DOT_TOP : FACE_DOT_TOP;
  return <UnreadGutterDot unread={unread} top={top} />;
}
