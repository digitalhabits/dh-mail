/**
 * The part of the frame script that re-lights a message for dark mode.
 *
 * JavaScript text that runs inside the message frame. See `link-bridge.ts`.
 * Do not use a backtick or a dollar-and-brace in this text.
 *
 * A message is written for a white page. On a dark card, its black words
 * and pale boxes do not read. So the frame turns the computed colours, once
 * it has laid out, and writes them back inline with `!important`:
 *
 *   background, near-grey and light  → dark. White becomes the card's shade.
 *                                      A light grey becomes a step above it,
 *                                      so alternating table rows stay visible.
 *   background, coloured and pale    → the same hue, dark.
 *   background, coloured and strong  → not changed. It reads on anything.
 *   text, dark                       → light, with the same hue.
 *   text, mid grey                   → lighter, so a footnote reads.
 *   text, light                      → not changed.
 *   borders                          → as backgrounds.
 *   pictures                         → not changed.
 *
 * A mail that declares its own dark styles (`prefers-color-scheme` in a style
 * block, or a `color-scheme` meta) keeps them.
 *
 * This ran from the page before. The frame has no shared origin with the
 * page now, so it runs here, when the page asks for it.
 */
export const FRAME_DARK_JS = String.raw`
var DARK_PAGE_L = 0.16;
var LOGO_MAX_HEIGHT_PX = 160;
var LOGO_MIN_SIDE_PX = 12;
var RECOLOR_SKIP = { IMG: 1, SVG: 1, VIDEO: 1, CANVAS: 1, PICTURE: 1, SOURCE: 1, SCRIPT: 1, STYLE: 1 };
var recolored = false;

function parseCssColor(value) {
  var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(value || "");
  if (!m) return null;
  var r = Number(m[1]) / 255;
  var g = Number(m[2]) / 255;
  var b = Number(m[3]) / 255;
  var a = 1;
  if (m[4] != null) a = /%$/.test(m[4]) ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  var max = Math.max(r, g, b);
  var min = Math.min(r, g, b);
  var l = (max + min) / 2;
  var h = 0;
  var s = 0;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h, s: s, l: l, a: a };
}

function hslToCss(c) {
  var parts = Math.round(c.h * 360) + "," + Math.round(c.s * 100) + "%," + Math.round(c.l * 100) + "%";
  return c.a < 1 ? "hsla(" + parts + "," + c.a + ")" : "hsl(" + parts + ")";
}

function withHsl(c, s, l) {
  return { h: c.h, s: s, l: l, a: c.a };
}

function darkBackground(c) {
  if (c.a === 0) return null;
  if (c.s < 0.28) {
    if (c.l < 0.55) return null;
    return withHsl(c, Math.min(c.s, 0.12), DARK_PAGE_L + (1 - c.l) * 0.28);
  }
  if (c.l >= 0.72) return withHsl(c, c.s * 0.5, 0.24 + (1 - c.l) * 0.35);
  return null;
}

function darkText(c) {
  if (c.a === 0) return null;
  if (c.s < 0.3) {
    if (c.l <= 0.45) return withHsl(c, c.s, Math.max(0.88, 1 - c.l));
    if (c.l < 0.66) return withHsl(c, c.s, 0.74);
    return null;
  }
  if (c.l < 0.6) return withHsl(c, Math.min(c.s, 0.75), Math.max(0.74, 1 - c.l));
  return null;
}

function darkBorder(c) {
  if (c.a === 0) return null;
  if (c.s < 0.3 && c.l >= 0.5) return withHsl(c, Math.min(c.s, 0.1), 0.32);
  return null;
}

function declaresOwnDark() {
  if (document.querySelector('meta[name="color-scheme"]')) return true;
  var styles = document.querySelectorAll("style");
  for (var i = 0; i < styles.length; i += 1) {
    if (/prefers-color-scheme\s*:\s*dark/i.test(styles[i].textContent || "")) return true;
  }
  return false;
}

function recolorOne(el, wasLight) {
  var cs = window.getComputedStyle(el);
  var bg = parseCssColor(cs.backgroundColor);
  var nextBg = bg && darkBackground(bg);
  if (nextBg) {
    if (bg.l > 0.6) wasLight.set(el, hslToCss(bg));
    el.style.setProperty("background-color", hslToCss(nextBg), "important");
  }
  var fg = parseCssColor(cs.color);
  var nextFg = fg && darkText(fg);
  if (nextFg) el.style.setProperty("color", hslToCss(nextFg), "important");
  if (cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0) {
    var bc = parseCssColor(cs.borderTopColor);
    var nextBorder = bc && darkBorder(bc);
    if (nextBorder) el.style.setProperty("border-color", hslToCss(nextBorder), "important");
  }
}

function recolorForDark() {
  if (recolored || !document.body) return;
  recolored = true;
  if (declaresOwnDark()) {
    document.documentElement.style.setProperty("color-scheme", "dark");
    return;
  }
  var wasLight = new Map();
  var all = document.body.querySelectorAll("*");
  for (var i = 0; i < all.length; i += 1) {
    var el = all[i];
    if (RECOLOR_SKIP[String(el.tagName).toUpperCase()]) continue;
    if (el.namespaceURI && el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    recolorOne(el, wasLight);
  }
  backPicturesWithTheirOwnGround(wasLight);
}

/*
  A small picture, a logo for example, keeps the light ground it was drawn
  against. This shows only through transparency. Spacers and tracking
  pixels are left alone.
*/
function groundOf(img, wasLight) {
  for (var node = img.parentElement; node; node = node.parentElement) {
    var found = wasLight.get(node);
    if (found) return found;
  }
  return null;
}

function giveGround(img, behind) {
  var box = img.getBoundingClientRect();
  if (box.height <= 0 || box.height > LOGO_MAX_HEIGHT_PX) return;
  if (box.height < LOGO_MIN_SIDE_PX || box.width < LOGO_MIN_SIDE_PX) return;
  if (img.naturalWidth <= 2 || img.naturalHeight <= 2) return;
  img.style.setProperty("background-color", behind, "important");
  img.style.setProperty("box-shadow", "0 0 0 3px " + behind, "important");
  img.style.setProperty("border-radius", "3px", "important");
}

function backPicturesWithTheirOwnGround(wasLight) {
  if (wasLight.size === 0) return;
  var images = document.querySelectorAll("img");
  for (var i = 0; i < images.length; i += 1) {
    (function (img) {
      var behind = groundOf(img, wasLight);
      if (!behind) return;
      var apply = function () { requestAnimationFrame(function () { giveGround(img, behind); }); };
      if (img.complete && img.naturalWidth > 0) apply();
      else img.addEventListener("load", apply, { once: true });
    })(images[i]);
  }
}
`;
