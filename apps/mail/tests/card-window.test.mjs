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
import { composeViewSource, threadPaneSource } from "./mail-page-source.mjs";

const src = (name) =>
  readFileSync(
    join(process.cwd(), "../../products/mail/packages/mail/components/mail", name),
    "utf8"
  );

/*
  The frame both floating cards stand in. It was the reply card's own
  wiring, inside ThreadPane; the new-mail card stands in the same one now,
  so the rules below are read there.
*/
const frame = src("floating-card.tsx");
const pane = threadPaneSource();
const compose = composeViewSource();
const drag = src("use-card-drag.ts");

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
    A size the reader dragged is an inline width and height, and it
    outlives the window it was chosen in. Held by its middle at a size the
    window no longer has, the card was drawn with its heading above the top
    of the screen and its right edge past the side — with no button left to
    press. The ceiling is the window, on every frame.
  */
  check(
    "and never larger than the window, whatever size it was given",
    full.includes("max-h-[calc(100vh-2rem)]") &&
      full.includes("max-w-[calc(100vw-2rem)]"),
    full.includes("max-w-none") ? "no ceiling" : "capped"
  );

  /*
    The backdrop is put in the page, not in the card: anything `fixed`
    inside an element that `transform` has moved is measured from that
    element, and the full-screen card is moved by exactly that.
  */
  const source = src("card-window.tsx");
  check(
    "the dimmed page is portalled out of the card",
    source.includes("createPortal(") && source.includes("document.body")
  );

  check(
    "the card put away shows none of what it holds",
    pane.includes('card.minimised && "hidden"') &&
      compose.includes('card.minimised && "hidden"')
  );
  check(
    "a card that is not in the corner is not carried by hand",
    frame.includes(
      'onPointerDown={card.view === "normal" ? card.startDrag : undefined}'
    )
  );
  check(
    "a card put away is not sized by hand either",
    frame.includes(
      'const sizeable = floating && view !== "minimised"'
    ) && frame.includes("{card.sizeable ? (")
  );
  /*
    Every edge and every corner, as a window has. The card had three
    handles, on the reasoning that a card in the bottom right corner is
    anchored by its other two. A card that can be carried does not stay in
    the corner, and a reader who has carried one reaches for its bottom
    right and finds nothing there.
  */
  const EDGES = [
    "left",
    "right",
    "top",
    "bottom",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ];
  const missing = EDGES.filter((e) => !frame.includes(`edge: "${e}"`));
  check(
    "a card is sized from all four edges and all four corners",
    missing.length === 0,
    missing.length ? `no handle for ${missing.join(", ")}` : "eight handles"
  );
  check(
    "each one knows which end of its axis the hand is on",
    EDGES.every((e) => drag.includes(`"${e}":`) || drag.includes(`${e}: {`)),
    drag.includes("const HELD") ? "named" : "missing"
  );
  check(
    "a far edge carries the anchor with it, so the near side stays put",
    drag.includes('held.x === "far"') &&
      drag.includes("base.x + ((next.width ?? box.width) - box.width)") &&
      drag.includes("base.y + ((next.height ?? box.height) - box.height)")
  );
  check(
    "and never in the middle, which is held by a transform of its own",
    drag.includes("if (centred) return;")
  );
  check(
    "the edges are wide enough to aim at, and the corners wider",
    frame.includes("w-2 cursor-ew-resize") &&
      frame.includes("h-2 cursor-ns-resize") &&
      frame.includes("h-6 w-6 cursor-nwse-resize"),
    frame.includes("w-1.5") ? "still 6px" : "8px, 24px corners"
  );

  /*
    The two shapes are not one shape. A dialog held by its middle grows
    from both ends of every edge, keeps its own size, and must never be
    given the corner card's carry: that is a transform, and the middle is
    held by one already.
  */
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
    "a stored size is cut to the window it is read in",
    drag.includes("Math.min(stored.width, room(MIN_CARD_WIDTH, window.innerWidth))") &&
      drag.includes("Math.min(stored.height, room(MIN_CARD_HEIGHT, window.innerHeight))")
  );
  check(
    "and read again when the window changes size",
    drag.includes('window.addEventListener("resize", readBoth)')
  );
  check(
    "a full card is filled by the message, as focus mode is",
    pane.includes("(Boolean(cardSize.height) || card.full)")
  );

  check(
    "and by its width too, rather than a share of it",
    pane.includes("compactComposer || fullWidthComposer || card.full")
  );

  check(
    "a press on the dimmed page is the way back out",
    source.includes("onClick={onDismiss}"),
    source.includes("onDismiss") ? "dismisses" : "inert"
  );
  check(
    "which the card answers by going back to the corner",
    frame.includes('onDismiss={() => card.setView("normal")}')
  );
  check(
    "and Escape says the same thing from the keyboard",
    frame.includes('if (event.key !== "Escape" || event.defaultPrevented) return;') &&
      frame.includes('setView("normal");')
  );

  /*
    Both cards, one frame. A reader who learns the reply card knows the
    new-mail card, because there is one of each thing and not two.
  */
  for (const [name, text] of [
    ["the reply card", pane],
    ["the new-mail card", compose],
  ]) {
    check(
      `${name} stands in the shared frame`,
      text.includes("useFloatingCard(") && text.includes("<FloatingCardChrome"),
      text.includes("useFloatingCard(") ? "in the frame" : "on its own"
    );
    check(
      `${name} takes where it stands from the frame`,
      text.includes("card.className") && text.includes("style={card.style}")
    );
  }
  check(
    "and the two remember their sizes apart",
    pane.includes('"dh-mail-floating-reply-size"') &&
      compose.includes('"dh-mail-floating-compose-size"')
  );
  check(
    "neither heading carries a fourth button back to the pane",
    !compose.includes('t("backToTheMessage")') && !pane.includes('t("backToThread")'),
    compose.includes("backToTheMessage") ? "still drawn" : "gone"
  );
  check(
    "the new-mail card names itself when it has no subject",
    compose.includes('subject.trim() || t("newEmail")'),
    compose.includes('t("newEmail")') ? "named" : "blank"
  );
  check(
    "and keeps the From, To and subject rows inside the card",
    compose.includes('<span className={labelClass}>{t("fieldFrom")}</span>') &&
      compose.includes('<span className={labelClass}>{t("fieldTo")}</span>') &&
      compose.includes('placeholder={t("subject")}')
  );
});
