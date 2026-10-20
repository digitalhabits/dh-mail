/**
 * The allowlist a message goes through (lib/mail/email-allowlist.ts and
 * lib/mail/email-url-policy.ts), held to the known ways past a sanitizer.
 *
 * Each check reads what a browser builds from the result, not its text, and
 * parses it a second time too: a mutation attack is markup that parses one
 * way, is written out, and parses as something else the next time. The
 * frame that shows a message is that next parse.
 *
 * Every address and every word here is invented.
 */

import { Window } from "happy-dom";

import { htmlHasRemoteImages, sanitizeEmailHtml } from "@/lib/mail/email-html";
import {
  isAllowedImageUrl,
  isAllowedLinkUrl,
  srcsetUrls,
  urlScheme,
} from "@/lib/mail/email-url-policy";

import { check, suite } from "./harness.mjs";

// Each function reads the DOM when it is called, not when it is imported.
const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

const parse = (html) => new win.DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

/** Characters a browser ignores in a URL, taken out before a scheme is read. */
const squash = (value) =>
  Array.from(value)
    .filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f)
    .join("")
    .toLowerCase();

/** Everything that could run, in a parsed document. Empty means none. */
function dangers(doc) {
  const found = [];
  for (const el of doc.querySelectorAll("*")) {
    const tag = el.localName.toLowerCase();
    if (["script", "iframe", "object", "embed", "svg", "math", "animate", "set", "form", "base", "meta"].includes(tag)) {
      found.push(`<${tag}>`);
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) found.push(`${tag}[${name}]`);
      const value = squash(attr.value);
      // Read as a browser reads an address: an entity left in the text is
      // not decoded, so "javascript&#x3a;" is a relative path, not a script.
      if (/^(javascript:|vbscript:|data:text|data:image\/svg)/.test(value)) found.push(`${tag}[${name}=${attr.value}]`);
    }
  }
  return found;
}

/** Sanitize, then parse twice, the way the frame will. */
function cleanTwice(html) {
  const once = sanitizeEmailHtml(html);
  const first = parse(once);
  const second = parse(first.body.innerHTML);
  return { once, first, second, problems: [...dangers(first), ...dangers(second)] };
}

suite(async () => {
  // --- The URL policy ----------------------------------------------------------

  check("a tab inside the scheme is read through", urlScheme("java\tscript:alert(1)") === "javascript");
  check("spaces and control characters before it too", urlScheme(" \u0001JavaScript:alert(1)") === "javascript");
  check("a relative address has no scheme", urlScheme("/a/b:c") === null && urlScheme("#top") === null);
  check("a link may be http, https, mailto or cid", ["https://x.example", "http://x.example", "mailto:a@x.example", "cid:part1"].every(isAllowedLinkUrl));
  check("a link may not be javascript, vbscript, data or file", !["javascript:x", "vbscript:x", "data:text/html,x", "data:image/png;base64,AA", "file:///etc/hosts"].some(isAllowedLinkUrl));
  check("a picture may be a raster data: URL", isAllowedImageUrl("data:image/png;base64,iVBORw0KGgo=") && isAllowedImageUrl("data:image/jpeg;base64,/9j/"));
  check("but not an SVG one, or an HTML one", !isAllowedImageUrl("data:image/svg+xml;base64,PHN2Zz4=") && !isAllowedImageUrl("data:text/html,<p>"));
  check("a picture needs a scheme", !isAllowedImageUrl("/relative.png"));
  check(
    "a srcset is read address by address, data: commas and all",
    JSON.stringify(srcsetUrls("https://a.example/1.png 1x, data:image/png;base64,AA,BB 2x,https://a.example/3.png")) ===
      JSON.stringify(["https://a.example/1.png", "data:image/png;base64,AA,BB", "https://a.example/3.png"]),
    JSON.stringify(srcsetUrls("https://a.example/1.png 1x, data:image/png;base64,AA,BB 2x,https://a.example/3.png"))
  );

  // --- javascript: in disguise ---------------------------------------------------

  for (const [name, href] of [
    ["a tab entity", "java&#9;script:alert(1)"],
    ["a line feed entity", "java&#10;script:alert(1)"],
    ["a decimal entity for the j", "&#106;avascript:alert(1)"],
    ["a hex entity for the colon", "javascript&#x3a;alert(1)"],
    ["mixed case and leading spaces", "  JaVaScRiPt:alert(1)"],
    ["a leading control character", "&#1;javascript:alert(1)"],
    ["vbscript", "vbscript:msgbox(1)"],
  ]) {
    const out = cleanTwice(`<p><a href="${href}">Read the minutes</a></p>`);
    check(`a link with ${name} loses its address and keeps its words`, out.problems.length === 0 && out.once.includes("Read the minutes"), `${out.problems.join(" ")} | ${out.once}`);
  }

  // --- SVG that rewrites a link ---------------------------------------------------

  {
    const animate = cleanTwice(
      '<p>Choir news.</p><svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><text x="20" y="20">Tap</text></a></svg>'
    );
    check("<svg><animate attributeName=href> goes, SVG and all", animate.problems.length === 0 && !/animate|svg/i.test(animate.once), animate.once);
    const set = cleanTwice('<svg><a><set attributeName="href" to="javascript:alert(1)"></set><circle r="9"></circle></a></svg><p>After.</p>');
    check("<svg><set to=javascript:> goes, SVG and all", set.problems.length === 0 && !/<set|<svg/i.test(set.once) && set.once.includes("After."), set.once);
    const xlink = cleanTwice('<svg><a xlink:href="javascript:alert(1)"><text>s</text></a></svg>');
    check("an SVG link with xlink:href goes", xlink.problems.length === 0, xlink.once);
  }

  // --- data: URLs -----------------------------------------------------------------

  {
    const html = cleanTwice('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Open</a>');
    check("a data:text/html link loses its address", html.problems.length === 0 && !/data:/i.test(html.once), html.once);
    const svgLink = cleanTwice('<a href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">Logo</a>');
    check("a data:image/svg+xml link loses its address", svgLink.problems.length === 0 && !/data:/i.test(svgLink.once), svgLink.once);
    const svgImg = cleanTwice('<img alt="logo" src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">');
    check("an SVG data: picture loses its address", svgImg.problems.length === 0 && !/data:/i.test(svgImg.once), svgImg.once);
    const png = sanitizeEmailHtml('<p>See</p><img alt="dot" src="data:image/png;base64,iVBORw0KGgo=">');
    check("a PNG data: picture keeps it", png.includes('src="data:image/png;base64,iVBORw0KGgo="'), png);
  }

  // --- Namespace confusion and mutation ----------------------------------------------

  for (const [name, html] of [
    ["<math><mtext><table><mglyph><style>", '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">'],
    ["<math><style> with markup in it", "<math><style><img src=x onerror=alert(1)></style></math>"],
    ["<svg><style> with markup in it", "<svg><style><img src=x onerror=alert(1)></style></svg>"],
    ["<svg></p><style> with a closing tag in an id", '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></style></svg>'],
    ["the form and mglyph mutation", "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>"],
    ["noscript, read with scripts off here and on in the frame", '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
    ["a style block inside a table", "<table><tr><td><style>td{color:red}</style>Cell</td></tr></table>"],
  ]) {
    const out = cleanTwice(html);
    check(`${name}: nothing runs after two parses`, out.problems.length === 0, `${out.problems.join(" ")} | ${out.once}`);
  }
  {
    const out = cleanTwice("<style>.note{color:#c00}</style><p class=\"note\">Bring a lamp.</p>");
    check("a sender's own style block stays", /<style[\s>]/.test(out.once) && out.once.includes(".note{color:#c00}"), out.once);
    const old = sanitizeEmailHtml("<style><!-- p{margin:0} --></style><p>Old Outlook CSS.</p>");
    check("a style block wrapped in <!-- --> stays: that does nothing inside <style>", old.includes("p{margin:0}"), old);
  }

  // --- What mail needs to keep --------------------------------------------------------

  {
    const out = sanitizeEmailHtml(
      '<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="#ffffff" background="https://cdn.example/bg.png">' +
        '<tr><td valign="top" class="hero" id="top" style="padding:8px"><font face="Georgia" color="#333333" size="3">Spring concert</font>' +
        '<img src="cid:logo@example" originalsrc="cid:logo@example" width="120" alt="logo"></td></tr></table>',
      { "logo@example": "data:image/png;base64,iVBORw0KGgo=" }
    );
    for (const attr of ['width="600"', 'cellpadding="0"', 'align="center"', 'bgcolor="#ffffff"', 'background="https://cdn.example/bg.png"', 'valign="top"', 'class="hero"', 'id="top"', 'face="Georgia"', 'color="#333333"', 'style="padding:8px']) {
      check(`a mail layout keeps ${attr}`, out.includes(attr), out);
    }
    check("an inline picture is put in from its content id", out.includes('src="data:image/png;base64,iVBORw0KGgo="'), out);
  }
  {
    const out = sanitizeEmailHtml('<p data-track="x1" data-dh-plain="" aria-hidden="true" name="n" onclick="x()">Hello</p>');
    check("a sender's data-, aria-, name and on- attributes go", !/data-track|aria-hidden|name=|onclick/.test(out), out);
    const forged = sanitizeEmailHtml('<span data-dh-href="javascript:alert(1)">Fake link</span>');
    check("a sender's own link span is checked like a link", !/javascript/i.test(forged), forged);
  }
  {
    const safe =
      "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnews.example%2Fspring&data=05%7C02&sdata=abc";
    const out = sanitizeEmailHtml(`<a href="${safe}">Spring news</a>`);
    check("a broken Microsoft safe link opens at the address it wraps", out.includes('data-dh-href="https://news.example/spring"'), out);
    const whole = `${safe.replace("sdata=abc", "sdata=" + "Z".repeat(43) + "%3D")}`;
    const kept = sanitizeEmailHtml(`<a href="${whole}">Spring news</a>`);
    check("a whole safe link is kept, so Microsoft's check at the click stays", kept.includes("safelinks.protection.outlook.com"), kept);
    check("and its hover text gives the real address", kept.includes('title="https://news.example/spring"'), kept);
    const wrapsScript =
      "https://eur01.safelinks.protection.outlook.com/?url=javascript%3Aalert(1)&data=05";
    const odd = sanitizeEmailHtml(`<a href="${wrapsScript}">Odd</a>`);
    check("a safe link that wraps a script stays a safe link, which is harmless", !/javascript:/i.test(odd), odd);
    const broken = `https://news.example/a?x=1&data${String.fromCharCode(5)}%7C02`;
    const mended = sanitizeEmailHtml(`<a href="${broken}">Broken</a>`);
    check("a link broken by a second decode is mended before it is checked", mended.includes("data=05%7C02"), mended);
  }
  {
    const out = cleanTwice(
      '<img alt="a" srcset="javascript:alert(1) 1x"><img alt="b" srcset="https://cdn.example/a.png 1x, data:image/svg+xml,PHN2Zz4= 2x">' +
        '<img alt="c" srcset="https://cdn.example/c.png 1x, https://cdn.example/c2.png 2x"><td background="javascript:alert(1)">x</td>'
    );
    check("a srcset with any bad address goes", !/javascript|svg\+xml/i.test(out.once), out.once);
    check("a srcset of plain addresses stays", out.once.includes("https://cdn.example/c2.png 2x"), out.once);
    check("background=javascript: goes", out.problems.length === 0, out.problems.join(" "));
  }
  {
    const out = sanitizeEmailHtml('<form action="https://x.example/"><p>Name</p><input name="a"><button>Send it</button></form><p>End.</p>');
    check("a form and its fields go, and their words stay", !/<form|<input|<button/i.test(out) && out.includes("Send it") && out.includes("End."), out);
  }

  // --- Remote pictures ---------------------------------------------------------------

  for (const [name, html, expected] of [
    ["an <img src>", '<img src="https://cdn.example/a.png">', true],
    ["a protocol-relative <img src>", '<img src="//cdn.example/a.png">', true],
    ["a srcset", '<img src="data:image/png;base64,AA" srcset="data:image/png;base64,AA 1x, https://cdn.example/a@2x.png 2x">', true],
    ["a srcset on <source>", '<picture><source srcset="https://cdn.example/a.webp"><img src="cid:a"></picture>', true],
    ["an SVG <image href>", '<svg><image href="https://cdn.example/a.png" width="10" height="10"/></svg>', true],
    ["an SVG <image xlink:href>", '<svg><image xlink:href="https://cdn.example/a.png"/></svg>', true],
    ["a table background=", '<table background="https://cdn.example/bg.jpg"><tr><td>x</td></tr></table>', true],
    ["a CSS url()", '<div style="background:url(\'https://cdn.example/bg.jpg\')">x</div>', true],
    ["an @import", '<style>@import "https://cdn.example/a.css";</style>', true],
    ["only inline pictures", '<img src="cid:logo"><img src="data:image/png;base64,AA">', false],
    ["a link and no picture", '<a href="https://news.example/">News</a>', false],
  ]) {
    check(`remote pictures: ${name}`, htmlHasRemoteImages(html) === expected, html);
  }
});
