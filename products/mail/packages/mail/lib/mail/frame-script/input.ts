/**
 * The part of the frame script that listens to the reader: link clicks,
 * the two right-click menus, a double click, keys and the pinch.
 *
 * This is JavaScript text, not code that runs in the app. It runs inside the
 * message frame, which has no access to the app page. Each thing it hears
 * goes to the page as one postMessage. See `link-bridge.ts` for the whole
 * script and its CSP hash.
 *
 * Do not use a backtick or a dollar-and-brace in this text. It is a
 * String.raw template, and the bytes are what the hash pins.
 */
export const FRAME_INPUT_JS = String.raw`
var HREF_ATTR = "data-dh-href";
var INTERACTIVE = "a[href], [data-dh-href], button, input, select, textarea, label, [role='button'], [role='link'], [contenteditable='true']";
var FIELD = 'input, textarea, select, [contenteditable="true"]';

function asElement(node) {
  return node && node.nodeType === 1 ? node : null;
}

/* The link around a node: a real anchor, or a softened link span. */
function linkOf(node) {
  for (var at = node; at && at !== document; at = at.parentNode) {
    if (at.nodeType !== 1) continue;
    if (String(at.tagName).toUpperCase() === "A" && at.hasAttribute("href")) return at;
    if (at.hasAttribute(HREF_ATTR)) return at;
  }
  return null;
}

/*
  Where a link goes: an absolute http(s) address or a mailto. A relative
  address has no base in a srcdoc frame, so it goes nowhere.
*/
function urlOf(link) {
  var raw = (link.getAttribute("href") || link.getAttribute(HREF_ATTR) || "").trim();
  if (!raw || raw.charAt(0) === "#") return null;
  if (/^mailto:/i.test(raw)) return raw;
  try {
    var absolute = new URL(raw).href;
    if (/^https?:/i.test(absolute)) return absolute;
  } catch (e) {}
  return null;
}

function imageOf(node) {
  for (var at = node; at && at !== document; at = at.parentNode) {
    if (at.nodeType === 1 && at.tagName === "IMG") return at.currentSrc || at.src || "";
  }
  return "";
}

function selectionNow() {
  var out = [];
  var sel = document.getSelection();
  if (!sel || sel.isCollapsed) return out;
  for (var i = 0; i < sel.rangeCount; i += 1) out.push(sel.getRangeAt(i).cloneRange());
  return out;
}

function putSelectionBack(ranges) {
  var sel = document.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  for (var i = 0; i < ranges.length; i += 1) sel.addRange(ranges[i]);
}

/* A point in the frame, with the frame's own size, so the page can scale it. */
function spot(event) {
  return { x: event.clientX, y: event.clientY, width: window.innerWidth, height: window.innerHeight };
}

var lastClickAt = 0;
var lastDoubleAt = 0;

/* Links. Every click on a link stops here, and the page opens it. */
document.addEventListener("click", function (event) {
  var link = linkOf(event.target);
  if (!link) return;
  lastClickAt = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
  var url = urlOf(link);
  if (url) send({ type: "open-url", url: url });
}, true);

/*
  The selection before a right-click. WebKit selects the word under the
  pointer before it fires contextmenu, so the selection is read on mousedown.
*/
var selectionBefore = [];
var linkWasSelected = false;

document.addEventListener("mousedown", function (event) {
  send({ type: "press" });
  var secondary = event.button === 2 || (event.button === 0 && event.ctrlKey);
  if (!secondary) return;
  selectionBefore = selectionNow();
  linkWasSelected = false;
  var link = linkOf(event.target);
  if (!link) return;
  for (var i = 0; i < selectionBefore.length; i += 1) {
    if (selectionBefore[i].intersectsNode(link)) linkWasSelected = true;
  }
}, true);

document.addEventListener("scroll", function () {
  send({ type: "press" });
}, true);

/*
  A right-click. On a link or a picture, the link menu. Anywhere else, the
  message menu, with the text that the reader selected before the click.
*/
document.addEventListener("contextmenu", function (event) {
  var at = spot(event);
  var link = linkOf(event.target);
  var image = imageOf(event.target);
  if ((link || image) && !linkWasSelected) {
    var url = link ? urlOf(link) || "" : "";
    if (url || image) {
      event.preventDefault();
      putSelectionBack(selectionBefore);
      send({ type: "link-menu", url: url, image: image, x: at.x, y: at.y, width: at.width, height: at.height });
      return;
    }
  }
  event.preventDefault();
  putSelectionBack(selectionBefore);
  var words = selectionBefore.map(function (range) { return range.toString(); }).join(" ").trim();
  send({ type: "message-menu", selectedText: words, x: at.x, y: at.y, width: at.width, height: at.height });
}, true);

/* True when the pointer is on the words themselves, not beside them. */
function onText(x, y) {
  var node = null;
  if (document.caretRangeFromPoint) {
    var caret = document.caretRangeFromPoint(x, y);
    node = caret ? caret.startContainer : null;
  } else if (document.caretPositionFromPoint) {
    var position = document.caretPositionFromPoint(x, y);
    node = position ? position.offsetNode : null;
  }
  if (!node || node.nodeType !== 3 || !String(node.textContent || "").trim()) return false;
  var range = document.createRange();
  range.selectNodeContents(node);
  var rects = range.getClientRects();
  for (var i = 0; i < rects.length; i += 1) {
    var r = rects[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

function isControl(event) {
  var target = asElement(event.target);
  return Boolean(target && target.closest && target.closest(INTERACTIVE));
}

/*
  A double click beside the words. WebKit is not reliable with dblclick in
  a srcdoc frame, so two clicks inside 400 ms count too, once.
*/
function doubleClicked(event) {
  if (isControl(event)) return;
  if (typeof event.clientX === "number" && onText(event.clientX, event.clientY)) return;
  var sel = document.getSelection();
  if (sel) sel.removeAllRanges();
  var now = Date.now();
  if (now - lastDoubleAt < 400) return;
  lastDoubleAt = now;
  lastClickAt = 0;
  event.preventDefault();
  send({ type: "dblclick" });
}

document.addEventListener("click", function (event) {
  if (isControl(event)) {
    lastClickAt = 0;
    return;
  }
  var now = Date.now();
  if (now - lastClickAt < 400) {
    doubleClicked(event);
    return;
  }
  lastClickAt = now;
}, true);
document.addEventListener("dblclick", doubleClicked, true);

/*
  Keys go to the page, where the shortcuts are. A key with Cmd or Ctrl does
  nothing in here, so that Cmd+R or Cmd+P cannot act on the frame. Plain
  Cmd+C and Cmd+A keep their work: copy and select all.
*/
document.addEventListener("keydown", function (event) {
  var target = asElement(event.target);
  if (target && target.closest && target.closest(FIELD)) return;
  var modified = event.metaKey || event.ctrlKey;
  var copyOrAll = modified && !event.shiftKey && !event.altKey && /^[ac]$/i.test(event.key);
  if (modified && !copyOrAll) event.preventDefault();
  send({
    type: "key",
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat
  });
}, true);

/* The pinch. The y is a share of the frame's height, from 0 to 1. */
function shareOfHeight(y) {
  var h = window.innerHeight;
  return typeof y === "number" && h > 0 ? y / h : null;
}

document.addEventListener("wheel", function (event) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  send({ type: "pinch-wheel", value: event.deltaY, at: shareOfHeight(event.clientY) });
}, { passive: false, capture: true });

var lastScale = 1;
document.addEventListener("gesturestart", function (event) {
  event.preventDefault();
  lastScale = typeof event.scale === "number" ? event.scale : 1;
}, { passive: false, capture: true });
document.addEventListener("gesturechange", function (event) {
  event.preventDefault();
  var scale = typeof event.scale === "number" ? event.scale : 1;
  if (lastScale > 0) send({ type: "pinch-scale", value: scale / lastScale, at: shareOfHeight(event.clientY) });
  lastScale = scale;
}, { passive: false, capture: true });
`;
