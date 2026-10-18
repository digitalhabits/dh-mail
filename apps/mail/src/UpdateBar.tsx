/**
 * The bar at the top when a new version is ready (2026-10-18 design):
 * what is ready, What's new, Later, and Restart to update.
 *
 * What's new opens a pop-up over the window, as the other pop-ups do, so
 * the list does not move: a change a row, from the release's own notes
 * (lib/mail/release-notes), a link to all the notes, and Restart there too.
 */

import * as React from "react";
import { ArrowUpRight } from "lucide-react";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { useMailT } from "@/lib/mail/i18n";
import { hasReleaseNotes, parseReleaseNotes } from "@/lib/mail/release-notes";
import type { TeamUpdate } from "@/lib/mail/team-update";
import { openExternalUrl } from "@/lib/native-shell";

/** Every release's notes, on the app's public source. */
const RELEASES_URL = "https://github.com/digitalhabits/dh-mail/releases";

const RESTART =
  "shrink-0 rounded-lg bg-[#1f5c4a] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#184a3c] disabled:opacity-60";

export function UpdateBar({
  update,
  error,
  installing,
  onLater,
  onInstall,
}: {
  update: TeamUpdate;
  error: string | null;
  installing: boolean;
  onLater: () => void;
  onInstall: () => void;
}) {
  const t = useMailT();
  const restart = (
    <button type="button" onClick={onInstall} disabled={installing} className={RESTART}>
      {installing ? t("updateRestarting") : t("updateRestart")}
    </button>
  );
  return (
    <div className="dh-top-banner flex items-center justify-between gap-4 border-b border-[#cfe5d9] bg-[#e6f3ec] py-2 text-sm text-[#1f5c4a]">
      <span className="min-w-0 truncate">
        {error ? t("updateFailed", { error }) : t("updateReady", { version: update.version })}
      </span>
      <span className="flex shrink-0 items-center gap-4">
        {hasReleaseNotes(update.notes) ? <WhatsNew update={update} restart={restart} /> : null}
        <button
          type="button"
          onClick={onLater}
          disabled={installing}
          className="text-xs font-semibold hover:text-[#184a3c] disabled:opacity-60"
        >
          {t("updateLater")}
        </button>
        {restart}
      </span>
    </div>
  );
}

function WhatsNew({ update, restart }: { update: TeamUpdate; restart: React.ReactNode }) {
  const t = useMailT();
  const notes = React.useMemo(() => parseReleaseNotes(update.notes), [update.notes]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-xs font-semibold underline underline-offset-4 hover:text-[#184a3c]">
          {t("updateWhatsNew")}
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[24rem] flex-col rounded-xl p-0"
      >
        <div className="min-h-0 overflow-y-auto px-4 pb-2 pt-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            {t("updateNewIn", { version: update.version })}
          </p>
          <ul className="mt-2 space-y-2.5">
            {notes.map((note, i) => (
              <li key={i}>
                {note.group && note.group !== notes[i - 1]?.group ? (
                  <p className="mb-1.5 mt-3 text-[11px] font-semibold text-stone-400 first:mt-0">{note.group}</p>
                ) : null}
                {note.title ? <p className="text-sm font-semibold text-stone-900">{note.title}</p> : null}
                {note.detail ? <p className="text-[13px] leading-snug text-stone-600">{note.detail}</p> : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#2f7a63] hover:text-[#1f5c4a]"
            onClick={() => void openExternalUrl(RELEASES_URL)}
          >
            {t("updateAllNotes")}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </button>
          {restart}
        </div>
      </MailPopoverContent>
    </Popover>
  );
}
