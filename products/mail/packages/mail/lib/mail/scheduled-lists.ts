/**
 * The scheduled mail of an Exchange mailbox, from its two sources.
 *
 * One list is on the server: what another mail app left held in Outbox
 * (exchange-send-later.ts). The other is on this computer: the drafts that
 * Mail sends later (scheduled-drafts.ts). They were read together, so when
 * the server did not answer, the mailbox listed nothing at all. A draft
 * that had missed its time then got no question and no row in Scheduled,
 * and showed only in Drafts (reported 2026-11-17; the diagnostics of that
 * week have "the held list failed" 15 times in three days).
 *
 * The list of this computer needs no server, so it is always given. The
 * server's list gets a time limit of its own, and gives nothing when it
 * fails or is slow.
 *
 * No React and no store here, so a suite can read it.
 */

export async function serverAndLocalLists<T>(
  server: Promise<T[]>,
  local: Promise<T[]>,
  waitMs: number,
  onServerFailure: (err: unknown) => void
): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${waitMs} ms`)), waitMs);
  });
  const fromServer = Promise.race([server, slow])
    .catch((err: unknown) => {
      onServerFailure(err);
      return [] as T[];
    })
    .finally(() => clearTimeout(timer));
  const [held, here] = await Promise.all([fromServer, local]);
  return [...held, ...here];
}
