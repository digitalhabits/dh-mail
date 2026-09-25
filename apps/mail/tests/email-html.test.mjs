/**
 * A message's HTML made safe, and a reply's quote cut off
 * (lib/mail/email-html.ts).
 *
 * The sanitizer is one of two guards: the frame's CSP is the other (see
 * EmailHtmlView.tsx). These checks hold the first one to what it promises:
 * no blocked element, no handler, no script link survives it. The mail is
 * invented.
 */

import { Window } from "happy-dom";

import { htmlHasRemoteImages, sanitizeEmailHtml, stripQuotedHtml } from "@/lib/mail/email-html";

import { check, suite } from "./harness.mjs";

// Each function reads the DOM when it is called, not when it is imported.
const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

suite(async () => {
  const dirty = [
    "<p>Hej Ulla</p>",
    "<script>alert(1)</script>",
    '<iframe src="https://evil.example/"></iframe>',
    '<object data="x.swf"></object><embed src="x.swf">',
    '<form action="https://evil.example/"><input name="pw"></form>',
    '<img src="https://pics.example/a.png" onerror="alert(2)" onload="alert(3)">',
    '<a href="javascript:alert(4)">click</a>',
    '<a href="  JavaScript:alert(5)">spaced</a>',
    '<a href="vbscript:msgbox(6)">vb</a>',
    '<a href="data:text/html,<script>alert(7)</script>">data</a>',
    '<div onclick="alert(8)" onmouseover="alert(9)">box</div>',
    '<svg><a xlink:href="javascript:alert(10)">s</a></svg>',
  ].join("");
  const out = sanitizeEmailHtml(dirty);
  // Checked on what a browser would build from the result, not on its text:
  // a word like "<script" left inside an attribute value is not a script.
  const doc = new win.DOMParser().parseFromString(out, "text/html");
  const els = [...doc.querySelectorAll("*")];
  const attrs = els.flatMap((el) => [...el.attributes]);
  const unsafe = /^\s*(javascript|vbscript|data:text\/html)/i;

  check("a script is taken out", !doc.querySelector("script"), out);
  check("frames, objects and embeds are taken out", !doc.querySelector("iframe,object,embed,frame,frameset,applet"), out);
  check("a form and its field are taken out", !doc.querySelector("form,input"), out);
  check("no on… handler survives", !attrs.some((a) => /^on/i.test(a.name)), out);
  check(
    "no link or source points at javascript:, vbscript: or data:text/html, spaced or in capitals",
    !attrs.some((a) => unsafe.test(a.value)),
    out
  );
  check("the words of the message stay", out.includes("Hej Ulla") && out.includes("box"), out);
  check("a picture stays, without its handlers", /<img[^>]+src="https:\/\/pics\.example\/a\.png"/.test(out), out);

  const escaped = sanitizeEmailHtml('<a href="data:text/html,&lt;b&gt;hi&lt;/b&gt;">d</a>');
  check("a data:text/html link written the usual way is dropped", !/data:text\/html/i.test(escaped), escaped);

  const linked = sanitizeEmailHtml('<p>See <a href="https://aavang.example/plan">the plan</a></p>');
  check("a safe link keeps where it goes", linked.includes("https://aavang.example/plan"), linked);
  check("and is marked as a link for the reader", /role="link"/.test(linked), linked);

  const bare = sanitizeEmailHtml("<p>Agenda at https://aavang.example/agenda today</p>");
  check("a bare address in the text becomes a link", /aavang\.example\/agenda/.test(bare) && /(href|data-dh-href)=/.test(bare), bare);

  const cid = sanitizeEmailHtml('<img src="cid:logo@x"><img src="cid:gone@x">', { "logo@x": "data:image/png;base64,AAAA" });
  check("an inline picture takes the data the server found for it", cid.includes("data:image/png;base64,AAAA"), cid);
  check("an inline picture that did not come is dropped", !cid.includes("cid:gone"), cid);

  check("a remote picture is seen", htmlHasRemoteImages('<img src="https://pics.example/a.png">'));
  check("a remote background is seen", htmlHasRemoteImages('<td style="background:url(https://pics.example/b.png)">'));
  check("an inline picture is not remote", !htmlHasRemoteImages('<img src="data:image/png;base64,AAAA">'));

  const reply = [
    "<div>Thursday works for me.</div>",
    "<div>On Tue, 3 Mar 2026, Tea Aavang wrote:</div>",
    "<blockquote><div>Can we move choir to Thursday?</div></blockquote>",
  ].join("");
  const cut = stripQuotedHtml(reply);
  check("a reply's quote is cut off", cut.hadQuote && !cut.html.includes("Can we move choir"), cut.html);
  check("with the line that introduced it", !cut.html.includes("wrote:"), cut.html);
  check("and the reply stays", cut.html.includes("Thursday works for me."), cut.html);

  const gmail = stripQuotedHtml('<div>Yes.</div><div class="gmail_quote"><div>Earlier words</div></div>');
  check("Gmail's quote box is cut off", gmail.hadQuote && !gmail.html.includes("Earlier words"), gmail.html);

  const header = stripQuotedHtml(
    "<div>Fine by me.</div><div>From: Tea Aavang<br>\nSent: Monday<br>\nSubject: Choir</div><div>Old text</div>"
  );
  check("a pasted From: and Subject: header starts the quote", header.hadQuote && !header.html.includes("Old text"), header.html);

  // Lines split by <br> alone, with nothing between the tag and the next
  // label: the text runs "MondaySubject:", and the label must still count.
  const tight = stripQuotedHtml(
    "<div>Fine by me.</div><div><b>From:</b> Tea Aavang<br><b>Sent:</b> Monday<br><b>Subject:</b> Choir</div><div>Old text</div>"
  );
  check("a pasted header with <br> and no space between its lines starts the quote", tight.hadQuote && !tight.html.includes("Old text"), tight.html);

  const forward = stripQuotedHtml("<blockquote><div>Only the quote</div></blockquote>");
  check("a message that is only a quote is kept whole", forward.html.includes("Only the quote"), forward.html);

  const plain = stripQuotedHtml("<p>No quote here.</p>");
  check("a message with no quote is left alone", !plain.hadQuote && plain.html === "<p>No quote here.</p>", plain.html);
});
