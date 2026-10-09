/**
 * Friction to start fetching again: random words to type before a pause can
 * be ended early.
 *
 * The same rule as Digital Habits: Blocker's "To stop early", kept simple for
 * Mail: always random words (no custom text), five letters each, from the
 * same list. Off (0 words) unless the reader sets a number. It only stands in
 * the way of ending a pause early; a pause that runs out ends by itself.
 *
 * Nothing here draws anything; UnpauseChallenge.tsx is the dialog.
 */

/** The most words the slider offers. */
export const MAX_UNPAUSE_WORDS = 100;

/** Five-letter words, as Blocker's list (`getWordList5`). */
const WORDS: readonly string[] = [
  "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
  "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
  "along", "alter", "among", "anger", "angle", "angry", "apart", "apple", "apply", "arena",
  "argue", "arise", "array", "aside", "asset", "audio", "audit", "avoid", "award", "aware",
  "badly", "baker", "bases", "basic", "basis", "beach", "began", "begin", "begun", "being",
  "below", "bench", "birth", "black", "blame", "blind", "block", "blood", "board", "boost",
  "booth", "bound", "brain", "brand", "bread", "break", "breed", "brief", "bring", "broad",
  "brown", "brush", "build", "built", "buyer", "cable", "carry", "catch", "cause", "chain",
  "chair", "chart", "chase", "cheap", "check", "chest", "chief", "child", "china", "chose",
  "civil", "claim", "class", "clean", "clear", "click", "clock", "close", "coach", "coast",
  "could", "count", "court", "cover", "craft", "crash", "cream", "crime", "cross", "crowd",
  "crown", "curve", "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "delay",
  "depth", "doing", "doubt", "dozen", "draft", "drama", "drawn", "dream", "dress", "drill",
  "drink", "drive", "drove", "dying", "eager", "early", "earth", "eight", "elite", "empty",
  "enemy", "enjoy", "enter", "entry", "equal", "error", "event", "every", "exact", "exist",
  "extra", "faith", "false", "fault", "fiber", "field", "fifth", "fifty", "fight", "final",
  "first", "fixed", "flash", "fleet", "floor", "fluid", "focus", "force", "forth", "forty",
  "forum", "found", "frame", "frank", "fraud", "fresh", "front", "fruit", "fully", "funny",
  "giant", "given", "glass", "globe", "going", "grace", "grade", "grand", "grant", "grass",
  "great", "green", "gross", "group", "grown", "guard", "guess", "guest", "guide", "happy",
  "heart", "heavy", "hence", "horse", "hotel", "house", "human", "ideal", "image", "index",
  "inner", "input", "issue", "japan", "joint", "judge", "known", "label", "large", "laser",
  "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal", "level", "light",
  "limit", "links", "lives", "local", "logic", "loose", "lower", "lucky", "lunch", "lying",
  "magic", "major", "maker", "march", "match", "maybe", "mayor",
];

/** A stored count as 0 (off) to MAX_UNPAUSE_WORDS; anything else is 0. */
export function normaliseUnpauseWords(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_UNPAUSE_WORDS, n);
}

/** `count` random words, one space between them. */
export function randomUnpauseWords(count: number, random: () => number = Math.random): string {
  const n = normaliseUnpauseWords(count);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(random() * WORDS.length)]);
  return out.join(" ");
}

/**
 * Minutes it takes to type `count` words, for the setting's label. Blocker's
 * estimate on a computer: 175 keystrokes a minute, letters and the spaces
 * between words. An estimate only; nothing is timed.
 */
export function unpauseMinutes(count: number): number {
  const n = normaliseUnpauseWords(count);
  if (!n) return 0;
  return Math.ceil((n * 5 + (n - 1)) / 175);
}

/**
 * What was typed, tidied the way Blocker tidies it: no space at the start,
 * one space between words, and typographic lookalikes (curly quotes, long
 * dashes, a no-break space) folded to the keys they stand for.
 */
export function tidyTyped(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[​-‍﻿⁠­]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/^\s+/, "")
    .replace(/\s{2,}/g, " ");
}

/** How many leading characters of `typed` are right. */
export function correctPrefixLength(typed: string, target: string): number {
  let i = 0;
  while (i < typed.length && i < target.length && typed[i] === target[i]) i++;
  return i;
}
