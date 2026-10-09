/** Optimistic send bubble (not yet replaced by a provider message id). */
export function isPendingLocalMessage(id: string): boolean {
  return id.startsWith("local-");
}
