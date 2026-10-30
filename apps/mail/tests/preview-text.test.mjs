/**
 * A preview in the list shows words, never the codes a newsletter pads them with.
 *
 * Newsletters hide their preheader behind invisible characters, and some write
 * those into the plain-text copy as HTML names: the list showed
 * "Acme &zwnj; &zwnj; &zwnj;" (2026-10-30). Invented text throughout.
 */

import { previewText } from "@/lib/mail/preview-text";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "named invisible characters are taken out",
    previewText("Acme &zwnj; &zwnj; &zwnj; &zwnj; Your new terms") === "Acme Your new terms"
  );
  check(
    "the characters themselves are taken out too",
    previewText("Acme‌ ‌ ͏­ ﻿Your new terms") === "Acme Your new terms"
  );
  check(
    "numbered ones are decoded and taken out",
    previewText("Acme &#847; &#8203; &#x200C; news") === "Acme news"
  );
  check(
    "ordinary names still decode",
    previewText("Tom &amp; Kim&#39;s plan &nbsp;today") === "Tom & Kim's plan today"
  );
  check(
    "a name cut off where the preview ends goes too",
    previewText("Acme. Your money &zwnj; &zwnj") === "Acme. Your money" &&
      previewText("Acme news &#84") === "Acme news" &&
      previewText("Acme news &") === "Acme news"
  );
  check("a real ampersand at the end stays", previewText("Call AT&T") === "Call AT&T");
  check("nothing is nothing", previewText(undefined) === "" && previewText("") === "");
  check(
    "plain words are left as they are",
    previewText("See you on Friday.") === "See you on Friday."
  );
});
