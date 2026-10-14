/**
 * Which HTML keeps its own layout in the Reader (lib/mail/reader-parts.ts).
 * The words are invented.
 */

import { htmlHasOwnLayout } from "@/lib/mail/reader-parts";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check("a newsletter table keeps its own layout", htmlHasOwnLayout('<table width="600"><tr><td>News</td></tr></table>'));
  check("paragraphs of a personal mail take the Reader's type", !htmlHasOwnLayout("<div>Hello</div><p>A long letter.</p>"));
});
