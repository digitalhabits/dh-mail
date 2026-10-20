/**
 * The part of the frame script that measures the message and sets its zoom.
 *
 * JavaScript text that runs inside the message frame. See `link-bridge.ts`.
 * Do not use a backtick or a dollar-and-brace in this text.
 *
 * The page cannot read the frame, so the frame measures itself and sends
 * three numbers:
 *
 *   height     the content height in frame pixels, with a small slack.
 *   natural    the width the message takes with nothing to fill, at zoom 1.
 *   narrowest  the width the message cannot go under, at zoom 1.
 *
 * The page decides the zoom from these and sends it back.
 *
 * The height is measured with the root and the body set to `height:auto`
 * for the length of the read. A mail with `height:100%` on a wrapper is as
 * tall as the frame it gets. Measured as it is, the answer is the frame, and
 * the frame grows each time. The page used to collapse the frame to 0 for
 * the read. It cannot do that through a message without a visible flash, so
 * the frame takes the percentages away instead.
 *
 * A wrapper in `vh` units still follows the frame. So a measurement that
 * grows by no more than the slack keeps the old height. The slack already
 * covers that much growth, and this stops the frame from growing for ever.
 */
export const FRAME_SIZE_JS = String.raw`
var SLACK_PX = 6;
var lastHeight = 0;

function addProbe(css) {
  var style = document.createElement("style");
  style.setAttribute("data-dh-probe", "1");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

/*
  The content height. The rect walk catches trailing margins. scrollHeight
  catches what the rects cannot see. The body's scrollHeight is in the
  body's own zoom, so it is scaled back to frame pixels.
*/
function contentHeight(body) {
  var top = body.getBoundingClientRect().top;
  var bottom = body.getBoundingClientRect().bottom;
  function include(el) {
    var rect = el.getBoundingClientRect();
    var margin = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
    if (rect.bottom + margin > bottom) bottom = rect.bottom + margin;
  }
  for (var i = 0; i < body.children.length; i += 1) include(body.children[i]);
  for (var el = body.lastElementChild; el; el = el.lastElementChild) include(el);
  var zoom = parseFloat(body.style.zoom) || 1;
  return Math.max(bottom - top, (body.scrollHeight || 0) * zoom);
}

function measure() {
  var body = document.body;
  if (!body) return;
  var unpinned = addProbe("html,body{height:auto!important;min-height:0!important;max-height:none!important}");
  var content = contentHeight(body);
  var zoom = parseFloat(body.style.zoom) || 1;
  var heldWidth = body.style.width;
  body.style.width = "max-content";
  var naturalBody = body.getBoundingClientRect().width;
  /*
    The narrowest width, read with every string breakable. What is left is
    the width of things that have one: a fixed table, a picture.
  */
  body.style.width = "min-content";
  var breakable = addProbe("*{overflow-wrap:anywhere!important;white-space:normal!important}");
  var styles = window.getComputedStyle(body);
  var rightPadding = parseFloat(styles.paddingRight) || 0;
  var narrowestBody = Math.max(
    body.getBoundingClientRect().width,
    (body.scrollWidth + rightPadding) * zoom
  );
  breakable.remove();
  unpinned.remove();
  body.style.width = heldWidth;
  var margins = (parseFloat(styles.marginLeft) || 0) + (parseFloat(styles.marginRight) || 0);

  var height = content > 0 ? Math.ceil(content + SLACK_PX) : 0;
  if (lastHeight > 0 && height > lastHeight && height - lastHeight <= SLACK_PX) height = lastHeight;
  if (height > 0) lastHeight = height;
  send({
    type: "size",
    height: height,
    natural: Math.ceil(naturalBody / zoom + margins),
    narrowest: Math.ceil(narrowestBody / zoom + margins),
    zoom: zoom
  });
}

var queuedFrame = 0;
var queuedTimer = 0;
function measureNow() {
  if (queuedFrame) cancelAnimationFrame(queuedFrame);
  if (queuedTimer) clearTimeout(queuedTimer);
  queuedFrame = 0;
  queuedTimer = 0;
  if (configured) measure();
}
/*
  Once per frame at most. A timer runs it too: a webview that is not on
  screen stops its animation frames, and the first of the two wins.
*/
function scheduleMeasure() {
  if (queuedFrame || queuedTimer) return;
  queuedFrame = requestAnimationFrame(measureNow);
  queuedTimer = setTimeout(measureNow, 300);
}

function setZoom(value) {
  if (!document.body || !(value > 0)) return;
  document.body.style.zoom = String(value);
  scheduleMeasure();
}

if (typeof ResizeObserver !== "undefined") {
  var sizeWatch = new ResizeObserver(scheduleMeasure);
  sizeWatch.observe(document.documentElement);
  if (document.body) sizeWatch.observe(document.body);
}
/* A picture that arrives late. Load events do not bubble, but they can be caught. */
document.addEventListener("load", scheduleMeasure, true);
document.addEventListener("error", scheduleMeasure, true);
`;
