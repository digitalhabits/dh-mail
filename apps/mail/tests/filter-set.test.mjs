/**
 * More than one filter at a time (lib/mail/filter-set.ts): All is no
 * filter, any other filter turns All off, the last one off turns All on,
 * and a place (Sent, Trash...) is never part of a set.
 */

import { filterIds, filterIsOn, joinFilters, toggleFilter } from "@/lib/mail/filter-set";

import { check, suite } from "./harness.mjs";

const PLACES = ["sent", "trash", "snoozed"];
const ORDER = ["all", "people", "other", "list:a"];

suite(async () => {
  check("All is no filter", filterIds("all", PLACES).length === 0 && filterIsOn("all", "all", PLACES));
  check("a place is no filter either", filterIds("sent", PLACES).length === 0 && !filterIsOn("sent", "all", PLACES));
  const one = toggleFilter("all", "people", PLACES, ORDER);
  check("a filter turns All off", one === "people" && !filterIsOn(one, "all", PLACES));
  const two = toggleFilter(one, "list:a", PLACES, ORDER);
  check("a second goes on beside it", two === "people+list:a" && filterIsOn(two, "people", PLACES) && filterIsOn(two, "list:a", PLACES));
  check("in the chips' order, whichever went on first", toggleFilter("list:a", "people", PLACES, ORDER) === "people+list:a");
  check("pressing one again takes it off", toggleFilter(two, "people", PLACES, ORDER) === "list:a");
  check("the last one off is All", toggleFilter("list:a", "list:a", PLACES, ORDER) === "all");
  check("from a place, a filter starts a set of its own", toggleFilter("trash", "other", PLACES, ORDER) === "other");
  check("All in a set is dropped", joinFilters(["all", "other"], ORDER) === "other");
});
