/**
 * The part of the frame script that paints words: the search words from the
 * list, and the matches of find-in-thread (Cmd+F).
 *
 * JavaScript text that runs inside the message frame. See `link-bridge.ts`.
 * Do not use a backtick or a dollar-and-brace in this text.
 *
 * Both use the CSS Custom Highlight API, so the sender's markup does not
 * change. The page sends the words. The frame finds them and paints them.
 * For find, the frame also sends back where each match is, so the page can
 * put the matches in reading order and scroll to one of them.
 *
 * The search-word match is the same as `highlightRanges` in
 * `search-highlight.ts`: a term marks each word that it starts, with case
 * and accents ignored. `frame-script.test.mjs` compares the two.
 */
export const FRAME_PAINT_JS = String.raw`
var SEARCH_HIT = "dh-search-hit";
var FIND_ALL = "mail-find";
var FIND_ACTIVE = "mail-find-active";
var WORD_CHAR = /[\p{L}\p{N}]/u;
var findRanges = [];

function paintStyle() {
  if (document.getElementById("dh-paint-style")) return;
  var style = document.createElement("style");
  style.id = "dh-paint-style";
  style.textContent =
    "::highlight(" + SEARCH_HIT + "){background-color:rgba(252,211,77,0.6);color:inherit}" +
    "::highlight(" + FIND_ALL + "){background-color:#fde68a;color:#1c1917}" +
    "::highlight(" + FIND_ACTIVE + "){background-color:#f59e0b;color:#1c1917}";
  (document.head || document.documentElement).appendChild(style);
}

function paint(name, ranges) {
  var registry = window.CSS && window.CSS.highlights;
  if (!registry || typeof Highlight === "undefined") return;
  if (!ranges.length) {
    registry.delete(name);
    return;
  }
  paintStyle();
  var highlight = new Highlight();
  for (var i = 0; i < ranges.length; i += 1) highlight.add(ranges[i]);
  registry.set(name, highlight);
}

function foldChar(c) {
  var folded = Array.from(c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return folded[0] || c;
}

/* [start, end) pairs over code points, as highlightRanges answers. */
function termRanges(text, terms) {
  var chars = Array.from(text).map(foldChar);
  var found = [];
  for (var t = 0; t < terms.length; t += 1) {
    var needle = Array.from(String(terms[t]));
    if (!needle.length) continue;
    for (var i = 0; i + needle.length <= chars.length; i += 1) {
      if (i > 0 && WORD_CHAR.test(chars[i - 1])) continue;
      var hit = true;
      for (var k = 0; k < needle.length; k += 1) {
        if (chars[i + k] !== needle[k]) { hit = false; break; }
      }
      if (hit) found.push([i, i + needle.length]);
    }
  }
  found.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
  var merged = [];
  for (var j = 0; j < found.length; j += 1) {
    var last = merged[merged.length - 1];
    if (last && found[j][0] <= last[1]) last[1] = Math.max(last[1], found[j][1]);
    else merged.push([found[j][0], found[j][1]]);
  }
  return merged;
}

function paintSearchWords(terms) {
  var ranges = [];
  if (Array.isArray(terms) && terms.length && document.body) {
    var walker = document.createTreeWalker(document.body, 4);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      var parentTag = node.parentElement ? node.parentElement.tagName : "";
      if (parentTag === "SCRIPT" || parentTag === "STYLE" || parentTag === "NOSCRIPT") continue;
      var text = node.nodeValue || "";
      var found = termRanges(text, terms);
      if (!found.length) continue;
      var offsets = [0];
      Array.from(text).forEach(function (c) { offsets.push(offsets[offsets.length - 1] + c.length); });
      for (var i = 0; i < found.length; i += 1) {
        var range = document.createRange();
        range.setStart(node, offsets[found[i][0]]);
        range.setEnd(node, offsets[found[i][1]]);
        ranges.push(range);
      }
    }
  }
  paint(SEARCH_HIT, ranges);
}

/* Visible text nodes, in reading order. */
function visibleTextNodes() {
  var skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
  var out = [];
  if (!document.body) return out;
  var walker = document.createTreeWalker(document.body, 4);
  for (var node = walker.nextNode(); node; node = walker.nextNode()) {
    var text = node.nodeValue;
    var parentEl = node.parentElement;
    if (!text || !text.trim() || !parentEl || skip[parentEl.tagName]) continue;
    if (!parentEl.offsetParent && parentEl.tagName !== "BODY") {
      var cs = window.getComputedStyle(parentEl);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
    }
    out.push(node);
  }
  return out;
}

/* Every match of a lower-case needle. A match can cross element edges. */
function findMatches(needle) {
  var nodes = visibleTextNodes();
  var joined = "";
  var starts = [];
  for (var i = 0; i < nodes.length; i += 1) {
    starts.push(joined.length);
    joined += nodes[i].nodeValue || "";
  }
  function locate(offset) {
    var low = 0;
    var high = nodes.length - 1;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { node: nodes[low], offset: offset - starts[low] };
  }
  var hay = joined.toLowerCase();
  var out = [];
  if (!needle || !nodes.length) return out;
  for (var at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + Math.max(needle.length, 1))) {
    try {
      var from = locate(at);
      var to = locate(at + needle.length - 1);
      var range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      out.push(range);
    } catch (e) {}
  }
  return out;
}

function find(id, needle) {
  findRanges = findMatches(String(needle || "").toLowerCase());
  paint(FIND_ALL, findRanges);
  paint(FIND_ACTIVE, []);
  var tops = findRanges.map(function (range) { return range.getBoundingClientRect().top; });
  send({ type: "find-result", id: id, tops: tops, height: window.innerHeight });
}

function showFound(id, index) {
  var range = findRanges[index];
  paint(FIND_ACTIVE, range ? [range] : []);
  if (!range) return;
  var box = range.getBoundingClientRect();
  send({ type: "find-shown", id: id, top: box.top, bottom: box.bottom, height: window.innerHeight });
}

function clearFind() {
  findRanges = [];
  paint(FIND_ALL, []);
  paint(FIND_ACTIVE, []);
}
`;
