/*
 * Where the parts of a recipient field stand, by its kind and whether
 * anybody is in it yet. See the note over `emptyRow` in RecipientField.
 */

/** Where the parts of a field stand: the box, its label, the place to type, the lists button. */
export function fieldLayout(variant: "boxed" | "inline", emptyRow: boolean) {
  if (emptyRow) {
    return {
      // The same height as the box with a line of chips in it. On the
      // baseline, so the small label sits on the line the address does:
      // centred, it stood about a pixel higher.
      box: "flex items-baseline rounded-xl border border-stone-200 bg-white px-2.5 py-2 focus-within:border-stone-300",
      label: "mr-1.5 shrink-0 text-xs text-muted-foreground",
      input: "min-w-0 flex-1",
      lists: "ml-2",
    };
  }
  return {
    box: "rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 focus-within:border-stone-300",
    /* As tall as the place to type and the chips, lifted as they are, so
       the middles line up. Middle-aligned on its own, the smaller type sat
       about two pixels low. */
    label: "mb-1 mr-1.5 inline-flex h-6 items-center align-middle text-xs text-muted-foreground",
    // Wide enough to type in, and it takes the rest of the line rather
    // than a line of its own.
    input: variant === "boxed" ? "mb-1 w-[16ch] max-w-full align-middle" : "min-w-0 flex-1",
    // The far right: a flex row reaches it with ml-auto, block flow by floating.
    lists: variant === "boxed" ? "float-right ml-2" : "ml-auto",
  };
}
