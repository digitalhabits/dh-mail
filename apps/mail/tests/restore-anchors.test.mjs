import {
  restoreAnchorsForEditing,
  softenAnchorsForParse,
} from "@/lib/mail/soften-anchors";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- The round trip ------------------------------------------------------
  // What the reader softens, the composer puts back. A message copied into
  // the box must keep the links it was written with.
  const original = '<p>Sign up at <a href="https://digitalhabits.org/demo">here</a>.</p>';
  const back = restoreAnchorsForEditing(softenAnchorsForParse(original));
  check("a link survives the round trip", /<a href="https:\/\/digitalhabits\.org\/demo">here<\/a>/.test(back), back);
  check("and nothing of the softening is left", !/data-dh-/.test(back), back);
  check("nor the role it was given", !/role="link"/.test(back), back);

  // ---- Spans that are only spans -------------------------------------------
  const styled = '<p><span style="font-weight:bold">Bold</span> words</p>';
  check(
    "a span with no address stays a span",
    restoreAnchorsForEditing(styled) === styled,
    restoreAnchorsForEditing(styled)
  );

  // ---- A span inside a link ------------------------------------------------
  // The close tags must pair up, or the anchor swallows the rest of the mail.
  const nested = restoreAnchorsForEditing(
    softenAnchorsForParse('<a href="https://x.example"><span style="color:red">Red</span> link</a> after')
  );
  check("the inner span closes as a span", /<span style="color:red">Red<\/span>/.test(nested), nested);
  check("the link closes as a link", /<\/a> after/.test(nested), nested);
  check("and the words after it are outside", nested.trim().endsWith("after"), nested);

  // ---- Nothing to do -------------------------------------------------------
  const plain = "<p>No links here.</p>";
  check("html with no spans is untouched", restoreAnchorsForEditing(plain) === plain, restoreAnchorsForEditing(plain));
});

import { trimAnchorEdges } from "@/lib/mail/soften-anchors";
import { check as check2, suite as suite2 } from "./harness.mjs";

suite2(async () => {
  // ---- Space inside a link ------------------------------------------------
  // Outlook hands the gap over inside the anchor, where it is underlined and
  // coloured as if it were part of the address.
  const leading = trimAnchorEdges('<p>sign up here: <a href="https://x.example"> x.example</a></p>');
  check2(
    "a space inside the link comes out of it",
    leading === '<p>sign up here: <a href="https://x.example">x.example</a></p>',
    leading
  );

  // The gap is not doubled: there was already one after the colon, and one
  // space between two words is the whole of what was meant.
  const nbsp = trimAnchorEdges('<p>at <a href="https://x.example">&nbsp;x.example</a></p>');
  check2("an &nbsp; inside it goes the same way", nbsp === '<p>at <a href="https://x.example">x.example</a></p>', nbsp);

  // With no gap outside, one is left behind so the words do not run together.
  const needed = trimAnchorEdges('<p>at:<a href="https://x.example"> x.example</a></p>');
  check2("a gap that was only inside is kept outside", needed === '<p>at: <a href="https://x.example">x.example</a></p>', needed);

  const trailing = trimAnchorEdges('<p><a href="https://x.example">x.example </a>and on</p>');
  check2("a trailing space comes out too", trailing === '<p><a href="https://x.example">x.example</a> and on</p>', trailing);

  const atTagEdge = trimAnchorEdges('<p><a href="https://x.example">x.example </a></p>');
  check2("and needs no gap against a tag", atTagEdge === '<p><a href="https://x.example">x.example</a></p>', atTagEdge);

  const clean = '<p>see <a href="https://x.example">x.example</a> now</p>';
  check2("a link with no space at its edges is untouched", trimAnchorEdges(clean) === clean, trimAnchorEdges(clean));
});
