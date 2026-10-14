"use client";

/**
 * Settings > Reading: from how many lines a message gets the Reader button.
 *
 * A number field between a minus and a plus, as the text size row has. The
 * value is kept per window in localStorage — see lib/mail/reader-settings.
 */

import * as React from "react";

import { SettingsRow } from "@/components/mail/settings-ui";
import { useMailT } from "@/lib/mail/i18n";
import {
  READER_LINES_MAX,
  READER_LINES_MIN,
  clampReaderLines,
  useReaderLineCutoff,
} from "@/lib/mail/reader-settings";

export function ReaderLinesSetting() {
  const t = useMailT();
  const [lines, setLines] = useReaderLineCutoff();
  /* What is typed, while the field is being edited. Null shows the setting. */
  const [draft, setDraft] = React.useState<string | null>(null);
  const step =
    "rounded-full px-1.5 text-[15px] leading-none text-stone-500 hover:bg-stone-200/70 hover:text-stone-800 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <SettingsRow
      label={t("readerLines")}
      hint={t("readerLinesHint")}
      control={
        <span className="flex items-center gap-1 rounded-full border border-stone-200 bg-white px-1.5 py-1">
          <button
            type="button"
            aria-label={t("readerLinesFewer")}
            title={t("readerLinesFewer")}
            disabled={lines <= READER_LINES_MIN}
            onClick={() => setLines(lines - 1)}
            className={step}
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={READER_LINES_MIN}
            max={READER_LINES_MAX}
            aria-label={t("readerLines")}
            data-reader-lines
            value={draft ?? String(lines)}
            onChange={(e) => {
              setDraft(e.target.value);
              const value = Number(e.target.value);
              if (e.target.value.trim() && Number.isFinite(value)) setLines(clampReaderLines(value));
            }}
            onBlur={() => setDraft(null)}
            className="w-9 bg-transparent text-center text-[12px] tabular-nums text-stone-700 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-[11px] text-stone-500">{t("readerLinesUnit")}</span>
          <button
            type="button"
            aria-label={t("readerLinesMore")}
            title={t("readerLinesMore")}
            disabled={lines >= READER_LINES_MAX}
            onClick={() => setLines(lines + 1)}
            className={step}
          >
            +
          </button>
        </span>
      }
    />
  );
}
