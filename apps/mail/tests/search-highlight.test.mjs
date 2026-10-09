/**
 * Which search words the rows paint, and where.
 *
 * The copy's index matches word prefixes with case and accents aside; the
 * paint follows it, so a marked row and a found row agree.
 */

import { highlightRanges, searchHighlightTerms } from "@/lib/mail/search-highlight";
import { check, suite } from "./harness.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

suite(async () => {
  check("plain words, folded", same(searchHighlightTerms("Paris  Nord"), ["paris", "nord"]));
  check("accents come off", same(searchHighlightTerms("Søbjerg"), ["søbjerg".normalize("NFD").replace(/[̀-ͯ]/g, "")]));
  check("a column's value is painted, a filter is not", same(searchHighlightTerms("from:Pardis has:attachment before:2026-01-01 paris"), ["pardis", "paris"]));
  check("a phrase stays whole", same(searchHighlightTerms('subject:"jet blue" OR trip'), ["jet blue", "trip"]));
  check("a word taken away is not painted", same(searchHighlightTerms("paris -newsletter"), ["paris"]));
  check("a URL is one word", same(searchHighlightTerms("https://x.test/a"), ["https://x.test/a"]));
  check("nothing from nothing", same(searchHighlightTerms("   "), []));

  check("a word is marked where it starts a word", same(highlightRanges("Your trip to Paris", ["paris"]), [[13, 18]]));
  check("a prefix marks the whole match only", same(highlightRanges("Parisian trip", ["paris"]), [[0, 5]]));
  check("not inside a word", same(highlightRanges("comparison", ["paris"]), []));
  check("case and accents aside", same(highlightRanges("Hôtel à PARIS", ["hotel", "paris"]), [[0, 5], [8, 13]]));
  check("overlaps merge", same(highlightRanges("paris parisian", ["paris", "parisian"]), [[0, 5], [6, 14]]));
  check("a phrase in order", same(highlightRanges("London → Paris Nord", ["paris nord"]), [[9, 19]]));
  check("an emoji counts once", same(highlightRanges("🎉 Paris", ["paris"]), [[2, 7]]));
  check("empty in, empty out", same(highlightRanges("", ["paris"]), []) && same(highlightRanges("Paris", []), []));
});
