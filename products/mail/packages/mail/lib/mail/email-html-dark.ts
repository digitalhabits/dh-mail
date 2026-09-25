/*
 * A message in dark mode: its colours turned for a dark page, and a small
 * picture given back the light ground it was drawn against.
 */

/*
 * Reading a sender's mail in the dark.
 *
 * A message is written for a white page. Its black words, its navy
 * headings, its pale pink call-out box are all choices made against white,
 * and putting them on a dark card as they are gives dark words on a dark
 * card. The answer every mail client has settled on — Outlook, Apple Mail,
 * Gmail — is not to protect the white page but to re-light the message:
 * flip the light backgrounds dark, lift the dark text light, and leave
 * alone the colours that already read either way.
 *
 * Done to the computed colours, from outside the frame, once it has laid
 * out. Computed rather than declared, because a colour can arrive by
 * `bgcolor=`, by inheritance, by a class in a `<style>` block, and the
 * result is what matters. Written back inline with `!important`, which
 * outranks anything the sender wrote.
 *
 * The rules, in HSL:
 *
 *   background, near-grey and light  → dark. White becomes the card's
 *                                      shade, a light grey a step above it,
 *                                      so a table with alternating rows
 *                                      keeps its rows.
 *   background, coloured and pale    → the same hue, dusky and dark: a pale
 *                                      pink box becomes a deep rose one.
 *   background, coloured and strong  → left. A brand's green band or blue
 *                                      button is legible on anything and is
 *                                      the sender's own mark.
 *   text, dark                       → light, keeping the hue: black to
 *                                      near-white, navy to a light blue.
 *   text, mid grey                   → lifted, so a footnote is readable.
 *   text, light                      → left; it was written for the coloured
 *                                      band it sits on.
 *   borders                          → as backgrounds.
 *   pictures                         → untouched. A logo on a white PNG
 *                                      stays a white PNG; so does Outlook's.
 *
 * A mail that carries its own dark styles — `prefers-color-scheme` in a
 * style block, or a `color-scheme` meta — is left to them and not
 * re-lit twice.
 */

type Hsl = { h: number; s: number; l: number; a: number };

function parseCssColor(value: string): Hsl | null {
  const m = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  const r = Number(m[1]) / 255;
  const g = Number(m[2]) / 255;
  const b = Number(m[3]) / 255;
  let a = 1;
  if (m[4] != null) a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s: sat, l, a };
}

function hslToCss({ h, s, l, a }: Hsl): string {
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return a < 1 ? `hsla(${H},${S}%,${L}%,${a})` : `hsl(${H},${S}%,${L}%)`;
}

/** The lightness the card is: what white becomes. */
const DARK_PAGE_L = 0.16;

function darkBackground(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.28) {
    // Near-grey. Only the light ones move; a dark grey box was already
    // designed for the dark.
    if (c.l < 0.55) return null;
    // White → the page shade; light greys step up from it in the same
    // order they stepped down from white, so stripes stay stripes.
    return { ...c, s: Math.min(c.s, 0.12), l: DARK_PAGE_L + (1 - c.l) * 0.28 };
  }
  // Coloured. Pale tints — a pink call-out, a mint banner — go dusky and
  // dark in the same hue; strong colours are the sender's own and stay.
  if (c.l >= 0.72) return { ...c, s: c.s * 0.5, l: 0.24 + (1 - c.l) * 0.35 };
  return null;
}

function darkText(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.3) {
    // Grey words. Near-black goes near-white; a mid grey — a footnote, a
    // timestamp — is unreadable on a dark card at the lightness it was
    // given for a white one, and comes up too.
    if (c.l <= 0.45) return { ...c, l: Math.max(0.88, 1 - c.l) };
    if (c.l < 0.66) return { ...c, l: 0.74 };
    return null;
  }
  // Coloured words: a navy heading, the blue of a link. Lightness alone
  // undersells how dark a saturated blue is — pure #0000ee is L 0.47 and
  // all but invisible on navy — so anything under 0.6 comes up to a light
  // tint of its own hue, and keeps it.
  if (c.l < 0.6) return { ...c, s: Math.min(c.s, 0.75), l: Math.max(0.74, 1 - c.l) };
  return null;
}

function darkBorder(c: Hsl): Hsl | null {
  if (c.a === 0) return null;
  if (c.s < 0.3 && c.l >= 0.5) return { ...c, s: Math.min(c.s, 0.1), l: 0.32 };
  return null;
}

/** Elements whose colours are their own business. */
const RECOLOR_SKIP = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "SOURCE", "SCRIPT", "STYLE"]);

export function recolorEmailForDark(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  // A mail that already knows about the dark is left to its own styles.
  const declares =
    doc.querySelector('meta[name="color-scheme"]') != null ||
    [...doc.querySelectorAll("style")].some((s) => /prefers-color-scheme\s*:\s*dark/i.test(s.textContent ?? ""));
  if (declares) {
    doc.documentElement.style.setProperty("color-scheme", "dark");
    return;
  }
  /**
   * What each element's background was before this darkened it.
   *
   * Pictures are left alone here — a photograph recoloured is a photograph
   * ruined — but a picture was drawn for the colour behind it, and that
   * colour is about to stop existing. Keeping the old one is what lets a
   * logo have it back.
   */
  const wasLight = new Map<HTMLElement, string>();
  const all = doc.body.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (RECOLOR_SKIP.has(el.tagName)) continue;
    // Inside an SVG the tag names are lower-case and the colours are fills.
    if (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const cs = win.getComputedStyle(el);
    const bg = parseCssColor(cs.backgroundColor);
    if (bg) {
      const next = darkBackground(bg);
      if (next) {
        if (bg.l > 0.6) wasLight.set(el, hslToCss(bg));
        el.style.setProperty("background-color", hslToCss(next), "important");
      }
    }
    const fg = parseCssColor(cs.color);
    if (fg) {
      const next = darkText(fg);
      if (next) el.style.setProperty("color", hslToCss(next), "important");
    }
    // Only a border that is actually drawn.
    if (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0) {
      const bc = parseCssColor(cs.borderTopColor);
      const next = bc && darkBorder(bc);
      if (next) el.style.setProperty("border-color", hslToCss(next), "important");
    }
  }

  backPicturesWithTheirOwnGround(doc, wasLight);
}

/**
 * Give a picture back the colour it was drawn against.
 *
 * A wordmark at the head of a newsletter is a PNG with a transparent
 * ground: the sender drew it dark because their mail is on white. Darken
 * the white and the letters are still there and still dark, on almost the
 * same dark — legible only by selecting them. Recolouring the picture
 * itself is not the answer, because a picture is not text and the same
 * treatment that rescues a logo ruins a photograph.
 *
 * So the picture keeps the ground it expected. Where a picture is opaque —
 * every photograph — this cannot be seen at all: it is behind the pixels.
 * It shows only through transparency, which is exactly where the sender was
 * relying on a colour that this reader no longer has.
 *
 * Only small ones, which is where the fault bites and where being wrong
 * costs least. A hero image with soft corners would show a pale edge, and
 * it is not the thing anybody is failing to read.
 */
const LOGO_MAX_HEIGHT_PX = 160;
/**
 * Under this in either direction it is not a picture, it is a measurement.
 *
 * Mail is full of images that are not pictures: the 1px transparent GIF
 * that opens a message's read receipt, and the spacer stretched across a
 * table to hold a column open. Giving one of those the ground it was drawn
 * against paints a white rule straight across the message — which is what
 * it did, on the first evening it shipped.
 */
const LOGO_MIN_SIDE_PX = 12;

function backPicturesWithTheirOwnGround(
  doc: Document,
  wasLight: Map<HTMLElement, string>
): void {
  if (wasLight.size === 0) return;
  const ground = (img: HTMLElement): string | null => {
    let node: HTMLElement | null = img.parentElement;
    while (node) {
      const found = wasLight.get(node);
      if (found) return found;
      node = node.parentElement;
    }
    return null;
  };
  const win = doc.defaultView;
  for (const img of doc.images) {
    const behind = ground(img);
    if (!behind) continue;
    const apply = () => {
      const box = img.getBoundingClientRect();
      const height = box.height;
      if (height <= 0 || height > LOGO_MAX_HEIGHT_PX) return;
      // Not a spacer, a tracking pixel, or a hairline rule.
      if (height < LOGO_MIN_SIDE_PX || box.width < LOGO_MIN_SIDE_PX) return;
      if (img.naturalWidth <= 2 || img.naturalHeight <= 2) return;
      img.style.setProperty("background-color", behind, "important");
      /*
        A little beyond its own edges, and rounded, so it reads as a card
        the mark is standing on rather than as the picture being cut out of
        the page. The spread goes on a shadow rather than on padding: this
        runs after the mail is laid out, and padding would move everything
        under it a few pixels down.
      */
      img.style.setProperty("box-shadow", `0 0 0 3px ${behind}`, "important");
      img.style.setProperty("border-radius", "3px", "important");
    };
    /*
      After a layout, not before one.

      This runs as the document is set up, which is before anything in it
      has been placed, so every picture measured nought high — the test for
      "small enough to be a logo" threw all of them away, including the one
      it was written for. A frame later they have their sizes.
    */
    if (img.complete && img.naturalWidth > 0) {
      if (win) win.requestAnimationFrame(apply);
      else apply();
    } else {
      img.addEventListener(
        "load",
        () => {
          if (win) win.requestAnimationFrame(apply);
          else apply();
        },
        { once: true }
      );
    }
  }
}
