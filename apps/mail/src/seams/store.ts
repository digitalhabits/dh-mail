/**
 * The store, for the standalone product.
 *
 * The bundler points `@/lib/mail/store` here, so the Postgres implementations
 * never enter the graph and no `pg` reaches the webview. This is why the store
 * needs no dynamic import: a build alias does the same job with less machinery.
 */

import { tauriMailStore } from "@/lib/mail/store/tauri";

import type { MailStore } from "@/lib/mail/store/types";

let current: MailStore = tauriMailStore;

export function setMailStore(store: MailStore): void {
  current = store;
}

export function mailStore(): MailStore {
  return current;
}
