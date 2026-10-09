/*
 * The filters the list is narrowed by, more than one at a time.
 *
 * All is on its own: it is no filter. Any other filter turns All off, and
 * the last one turned off turns All back on. The others go together, and
 * a conversation shows when it passes any one of them (People and a list
 * of your own: the mail of both). Scheduled filters whose times meet are
 * on together in the same way.
 *
 * The set is kept in the one value the list already had for its tab, the
 * ids joined with "+": "people+list:abc". A place (Sent, Trash, Snoozed…)
 * is never part of a set. "all" is the empty set.
 */

const SEP = "+";

/** The filter ids in a tab value; none for All or a place. */
export function filterIds(tab: string, places: readonly string[]): string[] {
  if (tab === "all" || places.includes(tab)) return [];
  return tab.split(SEP).filter(Boolean);
}

/** The tab value for these filters, in the chips' order; All when none. */
export function joinFilters(ids: readonly string[], order: readonly string[]): string {
  const unique = [...new Set(ids.filter((id) => id && id !== "all"))];
  if (!unique.length) return "all";
  const at = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return unique.sort((a, b) => at(a) - at(b)).join(SEP);
}

/**
 * A chip pressed: All clears the set; another filter goes in or comes out.
 * From a place, a filter starts a set of its own.
 */
export function toggleFilter(
  tab: string,
  id: string,
  places: readonly string[],
  order: readonly string[]
): string {
  if (id === "all") return "all";
  const ids = filterIds(tab, places);
  return joinFilters(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], order);
}

/** Is this chip lit? All when the set is empty and the list is no place. */
export function filterIsOn(tab: string, id: string, places: readonly string[]): boolean {
  if (id === "all") return tab === "all";
  return filterIds(tab, places).includes(id);
}
