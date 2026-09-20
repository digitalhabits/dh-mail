/**
 * A pasted picture goes into the words, or it goes as a file.
 *
 * The size decides. The limit is on the bytes of the picture, and the
 * composer has only a data: URI to measure, so the rule counts base64
 * characters: four of them for every three bytes.
 */

import { MAX_INLINE_PASTE_BYTES, dataUrlTooBig } from "@/lib/mail/inline-paste";
import { check, suite } from "./harness.mjs";

/** A data: URI whose payload decodes to about `bytes` bytes. */
const pictureOf = (bytes) =>
  `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

suite(async () => {
  check("the limit is two megabytes", MAX_INLINE_PASTE_BYTES === 2 * 1024 * 1024);

  check("a small picture goes into the words", !dataUrlTooBig(pictureOf(40_000)));

  check(
    "a picture at the limit still goes in",
    !dataUrlTooBig(pictureOf(MAX_INLINE_PASTE_BYTES))
  );

  check(
    "a picture over the limit goes as a file",
    dataUrlTooBig(pictureOf(MAX_INLINE_PASTE_BYTES + 3))
  );

  check(
    "the header of the data: URI does not count",
    !dataUrlTooBig(`data:image/png;name=${"x".repeat(4_000_000)};base64,AAAA`)
  );

  check(
    "text with no comma is measured whole",
    dataUrlTooBig("A".repeat(Math.ceil(((MAX_INLINE_PASTE_BYTES + 3) * 4) / 3)))
  );

  check("an empty string is not too big", !dataUrlTooBig(""));
});
