/**
 * The three sizes a floating card can be shown at.
 *
 * Out of the way, ordinary, or the whole window — the set Gmail has, so a
 * reader who knows one knows the other. Where the card stands is a string of
 * classes and can be read here; what it looks like is a person's job.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cardWindowClass } from "@/lib/mail/card-window";

import { check, suite } from "./harness.mjs";

const pane = readFileSync(
  join(
    process.cwd(),
    "../../products/mail/packages/mail/components/mail/ThreadPane.tsx"
  ),
  "utf8"
);

suite(async () => {
  const normal = cardWindowClass("normal");
  const away = cardWindowClass("minimised");
  const full = cardWindowClass("full");

  check(
    "the card stands in the bottom right corner",
    normal.includes("bottom-4") && normal.includes("right-6"),
    normal
  );
  check(
    "put away, it sits on the bottom edge and keeps the corner",
    away.includes("bottom-0") && away.includes("right-6"),
    away
  );
  check(
    "and is no taller than what it is given",
    away.includes("h-auto") && away.includes("max-h-none")
  );
  check(
    "filling the window, it is in the middle and over everything",
    full.includes("left-1/2") &&
      full.includes("top-1/2") &&
      full.includes("z-50"),
    full
  );
  check(
    "as wide as the window allows, up to a readable width",
    full.includes("w-[min(52rem,calc(100vw-4rem))]"),
    full.match(/w-\[[^\]]+\]/)?.[0]
  );

  /*
    The backdrop is put in the page, not in the card: anything `fixed`
    inside an element that `transform` has moved is measured from that
    element, and the full-screen card is moved by exactly that.
  */
  const source = readFileSync(
    join(
      process.cwd(),
      "../../products/mail/packages/mail/components/mail/card-window.tsx"
    ),
    "utf8"
  );
  check(
    "the dimmed page is portalled out of the card",
    source.includes("createPortal(") && source.includes("document.body")
  );

  check(
    "the card put away shows none of what it holds",
    pane.includes('floating && cardView === "minimised" && "hidden"')
  );
  check(
    "a card that is not in the corner is not carried by hand",
    pane.includes('onPointerDown={cardView === "normal" ? startDrag : undefined}')
  );
  check(
    "a card put away is not sized by hand either",
    pane.includes(
      'const cardSizeable = Boolean(floating) && cardView !== "minimised"'
    ) && pane.includes("{cardSizeable ? (")
  );
  check(
    "but the dialog is, from the edges a corner card has not",
    pane.includes('startCardResize("right")') &&
      pane.includes('startCardResize("bottom")') &&
      pane.includes('startCardResize("bottom-right")')
  );
  check(
    "and only the dialog draws those",
    pane.includes("{cardFull ? (")
  );

  /*
    The two shapes are not one shape. A dialog held by its middle grows
    from both ends of every edge, keeps its own size, and must never be
    given the corner card's carry: that is a transform, and the middle is
    held by one already.
  */
  const drag = readFileSync(
    join(
      process.cwd(),
      "../../products/mail/packages/mail/components/mail/use-card-drag.ts"
    ),
    "utf8"
  );
  check(
    "an edge of a centred card moves both sides",
    drag.includes("const grows = centred ? 2 : 1"),
    drag.includes("grows") ? "two inches to the inch" : "missing"
  );
  check(
    "the dialog keeps a size of its own",
    drag.includes("`${sizeKey}:centred`")
  );
  check(
    "and is never carried out of the middle",
    drag.includes("!centred && (offset.x || offset.y)")
  );
  check(
    "a full card is filled by the message, as focus mode is",
    pane.includes('(Boolean(cardSize.height) || cardView === "full")')
  );

  check(
    "and by its width too, rather than a share of it",
    pane.includes("compactComposer || fullWidthComposer || cardFull")
  );

  check(
    "a press on the dimmed page is the way back out",
    source.includes("onClick={onDismiss}"),
    source.includes("onDismiss") ? "dismisses" : "inert"
  );
  check(
    "which the card answers by going back to the corner",
    pane.includes('onDismiss={() => setCardView("normal")}')
  );
});
