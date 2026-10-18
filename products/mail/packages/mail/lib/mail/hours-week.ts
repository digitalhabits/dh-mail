/**
 * The week an hours editor draws: for each day, when the mailbox (or new
 * mail) is on, and which of those hours an unsaved change adds.
 *
 * Both sides are given as the settings keep them, the hours OFF
 * (account-rhythm.ts), and read minute by minute with the same test the
 * pause uses (`covers`, pause-lock.ts). So the chart, the lock and the
 * pause agree on every window, across midnight or all day.
 *
 * No React here: this is the part a suite reads.
 */

import { covers } from "@/lib/mail/pause-lock";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";

const MINUTES_PER_DAY = 24 * 60;

export type WeekRunKind = "on" | "added";

/** A run of minutes in one day, `from` to `to` (0 – 1440). */
export type WeekRun = { from: number; to: number; kind: WeekRunKind };

/**
 * The runs of each day, Monday first. `saved` is what is kept now; `draft`
 * is what the editor holds. A minute on in both is "on"; on only in the
 * draft is "added". A minute the draft takes away is simply off.
 */
export function weekRuns(saved: MailQuietWindow[], draft: MailQuietWindow[]): WeekRun[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const runs: WeekRun[] = [];
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      const at = day * MINUTES_PER_DAY + minute;
      if (covers(draft, at)) continue; // off in the draft
      const kind: WeekRunKind = covers(saved, at) ? "added" : "on";
      const last = runs[runs.length - 1];
      if (last && last.kind === kind && last.to === minute) last.to = minute + 1;
      else runs.push({ from: minute, to: minute + 1, kind });
    }
    return runs;
  });
}
