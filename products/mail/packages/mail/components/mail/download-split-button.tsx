"use client";

/**
 * Download, with a second section that says where: the pattern of Send.
 *
 * Download saves to the folder ticked in the menu (Downloads until another
 * is picked). The menu has Save as… (also Download with ⌥), the folders it
 * can save to — Downloads, the Desktop and the last few used — and Always
 * ask where to save. Picking a folder saves there and makes it the folder
 * from then on (lib/mail/download-folder).
 *
 * A browser saves a link by itself and keeps its own choices, so there the
 * button stays a plain download link.
 */

import * as React from "react";
import { Check, ChevronDown, Download } from "lucide-react";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { attachmentDownloadProps } from "@/components/mail/attachment-files";
import { hostSavesAttachments, saveAttachment } from "@/lib/mail/attachment-source";
import {
  alwaysAskWhereToSave,
  chooseDownloadFolder,
  downloadFolder,
  folderName,
  folderShort,
  recentDownloadFolders,
  setAlwaysAskWhereToSave,
} from "@/lib/mail/download-folder";
import { useMailT } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { cn } from "@/lib/utils";

type Places = { downloads: string | null; desktop: string | null; home: string | null };

const LOOK = {
  // In a header beside Open: quiet, as the actions around it.
  soft: {
    main: "inline-flex items-center gap-1.5 rounded-l-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100",
    more: "inline-flex items-center rounded-r-md border-l border-teal-200/70 bg-teal-50 px-1 text-teal-700 hover:bg-teal-100",
    icon: "h-3.5 w-3.5",
  },
  // The one thing to do with a file there is no preview of.
  solid: {
    main: "inline-flex items-center gap-2 rounded-l-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700",
    more: "inline-flex items-center rounded-r-lg border-l border-white/25 bg-teal-600 px-2 text-white hover:bg-teal-700",
    icon: "h-4 w-4",
  },
} as const;

export function DownloadSplitButton({
  path,
  filename,
  look = "soft",
}: {
  path: string;
  filename: string;
  look?: keyof typeof LOOK;
}) {
  const t = useMailT();
  const style = LOOK[look];
  const [open, setOpen] = React.useState(false);
  const [places, setPlaces] = React.useState<Places | null>(null);
  // Read when the menu opens, so it shows what is true now.
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [ask, setAsk] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setChosen(downloadFolder());
    setRecent(recentDownloadFolders());
    setAsk(alwaysAskWhereToSave());
    if (places) return;
    const invoke = tauriInvoke();
    if (!invoke) return;
    void (invoke("download_places") as Promise<Places>).then(setPlaces).catch(() => undefined);
  }, [open, places]);

  if (!hostSavesAttachments) {
    return (
      <a {...attachmentDownloadProps({ path, filename })} className={cn(style.main, "rounded-r-md")}>
        <Download className={style.icon} />
        {t("download")}
      </a>
    );
  }

  const save = (options: { folder?: string | null; ask?: boolean }) => {
    void saveAttachment({ path, filename, ...options }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save the file");
    });
  };
  const pick = (folder: string | null) => {
    setOpen(false);
    chooseDownloadFolder(folder);
    save({ folder, ask: false });
  };

  // Downloads first, then the Desktop, then the last folders used.
  const downloads = places?.downloads ?? null;
  const named = [places?.desktop, ...recent].filter(
    (f, i, all): f is string => Boolean(f) && f !== downloads && all.indexOf(f) === i
  );
  const row =
    "flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";
  const tick = (on: boolean) => (
    <span className="w-4 shrink-0 self-center text-teal-700">{on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}</span>
  );

  return (
    <span className="inline-flex items-stretch">
      <button
        type="button"
        className={style.main}
        // ⌥ asks where, as Save as… does.
        onClick={(e) => save({ ask: e.altKey ? true : undefined })}
      >
        <Download className={style.icon} />
        {t("download")}
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={style.more} aria-label={t("downloadOptions")} title={t("downloadOptions")}>
            <ChevronDown className={style.icon} aria-hidden />
          </button>
        </PopoverTrigger>
        <MailPopoverContent align="end" className="w-80 rounded-xl p-1.5">
          <button
            type="button"
            className={row}
            onClick={() => {
              setOpen(false);
              save({ ask: true });
            }}
          >
            <span className="flex-1">{t("saveAs")}</span>
            <span className="text-xs text-stone-400">{t("optionClick")}</span>
          </button>
          <div className="mx-1.5 my-1 border-t border-stone-100" />
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            {t("saveTo")}
          </p>
          <button type="button" className={row} onClick={() => pick(null)}>
            {tick(chosen == null || chosen === downloads)}
            <span className="flex-1">{t("downloadsFolder")}</span>
            <span className="text-xs text-stone-400">{downloads ? folderShort(downloads, places?.home ?? null) : ""}</span>
          </button>
          {named.map((folder) => (
            <button key={folder} type="button" className={row} title={folder} onClick={() => pick(folder)}>
              {tick(chosen === folder)}
              <span className="min-w-0 flex-1 truncate">
                {folder === places?.desktop ? t("desktopFolder") : folderName(folder)}
              </span>
              <span className="max-w-[45%] truncate text-xs text-stone-400">
                {folderShort(folder, places?.home ?? null)}
              </span>
            </button>
          ))}
          <div className="mx-1.5 my-1 border-t border-stone-100" />
          <label className={cn(row, "cursor-pointer items-center")}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-700"
              checked={ask}
              onChange={(e) => {
                setAsk(e.target.checked);
                setAlwaysAskWhereToSave(e.target.checked);
              }}
            />
            <span>{t("alwaysAskWhereToSave")}</span>
          </label>
        </MailPopoverContent>
      </Popover>
    </span>
  );
}
