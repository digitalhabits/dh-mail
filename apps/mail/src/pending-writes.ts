/**
 * The writes the mailbox has not confirmed yet.
 *
 * A delete or an archive is optimistic on screen and a request underneath,
 * and the request runs in this webview — a window closed right behind the
 * click killed it, the mailbox was never told, and the mail was back on the
 * next open. Every mutating call is counted here, and the count is mirrored
 * to the shell, which holds a closing window (and a quitting app) until it
 * reaches zero. See `pending.rs` and the guards in the app's `lib.rs`.
 */

import { tauriInvoke } from "@/lib/mail/store/tauri";

let pending = 0;

function report(): void {
  const invoke = tauriInvoke();
  if (!invoke) return;
  void invoke("set_pending_mail_writes", { count: pending }).catch(() => {});
}

/** Count this write until it settles, either way. Returns the same promise. */
export function trackMailWrite<T>(work: Promise<T>): Promise<T> {
  pending += 1;
  report();
  const done = () => {
    pending -= 1;
    report();
  };
  work.then(done, done);
  return work;
}
