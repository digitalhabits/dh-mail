"use client";

import * as React from "react";

/**
 * The same object for as long as every field holds the same value.
 *
 * The page's slices are objects of many fields. Writing each field twice,
 * once in the object and once in the list of dependencies, is two lists to
 * keep in step. This takes the object once and compares its values with
 * `Object.is`, as `useMemo` does with its list.
 *
 * Give it an object with the same keys, in the same order, on every
 * render. Then the list of values has a fixed length, which `useMemo` needs.
 */
export function useMemoObject<T extends Record<string, unknown>>(value: T): T {
  // Both rules ask for a list written out. This list is the object's
  // values: the same keys each render, so the same length.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  return React.useMemo(() => value, Object.values(value));
}
