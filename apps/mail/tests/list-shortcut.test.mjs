/**
 * What starts a list as it is typed.
 *
 * Quill's own rule took any number: "13. december" became a numbered list,
 * and Quill's list shows it as "1. december". Only "1. " starts one now.
 */

import { LIST_SHORTCUT_PREFIX } from "@/lib/list-shortcut";

import { check, suite } from "./harness.mjs";

const starts = (text) => LIST_SHORTCUT_PREFIX.test(text);

suite(async () => {
  check('"1." starts a numbered list', starts("1."));
  check("and so it does after spaces", starts("  1."));
  check('"13." is a date, not a list', !starts("13."));
  check('"2." stays text too', !starts("2."));
  check('"10." stays text', !starts("10."));
  check('"01." stays text', !starts("01."));
  check('"-" starts a bullet list', starts("-"));
  check('"*" starts a bullet list', starts("*"));
  check('"[ ]" starts a checklist', starts("[ ]"));
  check('"[]" too', starts("[]"));
  check('"[x]" starts a ticked one', starts("[x]"));
  check("a word does not", !starts("Hej"));
  check('nor "1" without its full stop', !starts("1"));
});
