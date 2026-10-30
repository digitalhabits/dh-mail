/**
 * A conversation's first words, as the list shows them.
 *
 * Newsletters pad the hidden "preheader" after their first words with
 * invisible characters, so a mail program shows only those words. Some
 * write the padding into the plain-text copy as the HTML names themselves
 * — "&zwnj; &zwnj; &zwnj;" — and the list showed those names as text
 * (Xero, Wise, 2026-10-30). Any route a preview comes by can carry them:
 * Gmail's own snippet, Outlook's preview, or one made from the body here.
 *
 * So the list cleans the words as it shows them: names decoded, the
 * invisible characters taken out, and the spaces they leave closed up.
 */

import { decodeHtmlEntities } from "@/lib/html-entities";

/** Characters with no width: joiners, soft hyphens, marks for direction. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g;

/** The names `decodeHtmlEntities` does not know, all of them invisible. */
const INVISIBLE_NAMES = /&(?:zwnj|zwj|shy|lrm|rlm|ZeroWidthSpace|NoBreak|NegativeThinSpace|NegativeMediumSpace|NegativeThickSpace|NegativeVeryThinSpace);/g;

/**
 * A name cut off where the preview ends: "money &zwnj" (Wise). Only the
 * starts of the names above and of numbers, so "AT&T" keeps its "&T".
 */
const CUT_NAME = /\s*&(?:#x?[0-9a-f]*|z|zw|zwn|zwnj|zwj|s|sh|shy|n|nb|nbs|nbsp|l|lr|lrm|r|rl|rlm)?$/i;

export function previewText(text: string | null | undefined): string {
  if (!text) return "";
  return decodeHtmlEntities(text.replace(INVISIBLE_NAMES, "").replace(CUT_NAME, ""))
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}
