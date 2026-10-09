/**
 * Friction to start fetching again: the random words a pause asks for before
 * it can be ended early, and the count kept with the pause.
 */

import { readPauseState } from "@/lib/mail/quiet-hours";
import {
  correctPrefixLength,
  MAX_UNPAUSE_WORDS,
  normaliseUnpauseWords,
  randomUnpauseWords,
  tidyTyped,
  unpauseMinutes,
} from "@/lib/mail/unpause-friction";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check("off unless a number is set", normaliseUnpauseWords(undefined) === 0 && normaliseUnpauseWords("x") === 0);
  check("no negative counts", normaliseUnpauseWords(-3) === 0);
  check("whole words only", normaliseUnpauseWords(4.7) === 4);
  check("capped at the slider's top", normaliseUnpauseWords(5000) === MAX_UNPAUSE_WORDS);

  const words = randomUnpauseWords(7).split(" ");
  check("the asked number of words", words.length === 7, words.join(" "));
  check("five letters each, lower case", words.every((w) => /^[a-z]{5}$/.test(w)), words.join(" "));
  check("none at all for 0", randomUnpauseWords(0) === "");

  check("no time for no words", unpauseMinutes(0) === 0);
  check("a few words take about a minute", unpauseMinutes(2) === 1);
  check("a hundred words take a few minutes", unpauseMinutes(100) === 4, String(unpauseMinutes(100)));

  check("typing drops a leading space", tidyTyped("  above birth") === "above birth");
  check("and doubled spaces", tidyTyped("above   birth") === "above birth");
  check("and reads a no-break space as a space", tidyTyped("above birth") === "above birth");
  check("the right part is counted up to the first slip", correctPrefixLength("abovx", "above birth") === 4);
  check("all of it when it matches", correctPrefixLength("above birth", "above birth") === 11);

  check("the count is kept with the pause", readPauseState({ quietHours: [], unpauseWords: 12 }).unpauseWords === 12);
  check("a pause with none keeps none", !("unpauseWords" in readPauseState({ quietHours: [] })));
  check("a stored count past the cap is capped", readPauseState({ quietHours: [], unpauseWords: 900 }).unpauseWords === MAX_UNPAUSE_WORDS);
});
