"use client";

/*
 * The files on a message: the chips under a bubble, the tile with its PDF
 * thumbnail, the menu on a file, and the roll-up of every file in a thread.
 *
 * The parts beside this one:
 *
 *   attachment-files.tsx    size, type, bytes, download, drag, open outside
 *   attachment-preview.tsx  the preview of a file, from a message or a draft
 *   draft-attachments.tsx   the files on a draft, and paste and drop
 */

import * as React from "react";
import { Calendar, Download, ExternalLink, Eye, ImageIcon, Loader2, Paperclip } from "lucide-react";

import { MENU_ICON, MENU_ITEM, MenuShell } from "@/components/mail/MenuShell";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { canRenderPdf, renderPdfThumbnail } from "@/lib/mail/attachment-text";
import { openAttachmentSource } from "@/lib/mail/attachment-source";
import {
  attachmentUrl,
  downloadAllAttachments,
  downloadAttachment,
  savableAttachments,
} from "@/lib/mail/attachment-save";
import { isCalendarAttachment } from "@/lib/mail/ics";
import { useMailT } from "@/lib/mail/i18n";
import type { MailAttachment } from "@/lib/mail/types";
import {
  TypeBadge,
  attachmentDragProps,
  formatFileSize,
  isImageMime,
  isPdfMime,
  openAttachmentOutside,
  useAttachmentSource,
} from "@/components/mail/attachment-files";

/**
 * One file on a message: always the same tile.
 *
 * A picture fills it, a document shows the badge for its kind. That is the
 * whole difference. Before this a photograph was a card, a PDF was a wide
 * row, and several pictures were packed into a collage — three shapes at
 * three sizes down one message, which read as a mess rather than as a set
 * of files.
 */
/**
 * How big a PDF may be before its first page is not drawn.
 *
 * Drawing one means reading the whole file through the transport, and the
 * tile is a hundred pixels of a message somebody is only reading. A scan
 * of a contract is a megabyte or two; past this it is a document to open
 * rather than to glance at, and the badge says what it is.
 */
const PDF_THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;
/** The tile is 184 wide; the page is drawn to that and no larger. */
const PDF_THUMBNAIL_WIDTH = 184;

/**
 * The first page of a PDF, once the tile has been looked at.
 *
 * Not on mount: a message with eight attachments would read eight whole
 * files the moment it opened, for pictures nobody may scroll to. The page
 * is drawn when the tile comes into view, and once for as long as it is
 * there.
 */
function usePdfThumbnail(
  ref: React.RefObject<HTMLElement | null>,
  path: string | null,
  sizeBytes: number
): string | null {
  const [src, setSrc] = React.useState<string | null>(null);
  const wanted =
    canRenderPdf && path != null && sizeBytes <= PDF_THUMBNAIL_MAX_BYTES;

  React.useEffect(() => {
    setSrc(null);
    const el = ref.current;
    if (!wanted || !el || !path) return;
    let live = true;
    let started = false;

    const draw = async () => {
      if (started) return;
      started = true;
      let source: { url: string; release: () => void } | null = null;
      try {
        source = await openAttachmentSource(path);
        const res = await fetch(source.url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!live) return;
        const drawn = await renderPdfThumbnail(bytes, PDF_THUMBNAIL_WIDTH);
        if (live && drawn) setSrc(drawn);
      } catch (err) {
        console.warn("mail: no first page for this PDF", err);
      } finally {
        source?.release();
      }
    };

    /*
      Asked of the rectangle, not of an observer.

      An IntersectionObserver is the obvious tool and it did not report at
      all on these tiles — no zoom above them, no content-visibility, the
      tile plainly on screen. Rather than build a picture on a thing that
      answers sometimes, the tile is measured: it is a comparison of two
      numbers on scroll, which is what the observer was going to say.
    */
    const nearlyVisible = () => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return false;
      // A margin, so a tile just under the fold is ready by the time it
      // arrives rather than drawing while it is looked at.
      const margin = 200;
      return box.bottom > -margin && box.top < window.innerHeight + margin;
    };

    let frame = 0;
    const check = () => {
      frame = 0;
      if (!live || started) return;
      if (nearlyVisible()) {
        stop();
        void draw();
      }
    };
    const schedule = () => {
      if (frame || started) return;
      frame = window.requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    check();
    return () => {
      live = false;
      stop();
    };
  }, [ref, path, wanted]);

  return src;
}

function AttachmentTile({
  account,
  messageId,
  attachment,
  onPreview,
  onMenu,
}: {
  account: string;
  messageId: string;
  attachment: MailAttachment;
  onPreview: () => void;
  onMenu: (
    e: React.MouseEvent,
    file: { path: string; filename: string; onPreview: () => void }
  ) => void;
}) {
  const pending = attachment.attachmentId.startsWith("local-");
  const image = isImageMime(attachment.mimeType, attachment.filename);
  const pdf = isPdfMime(attachment.mimeType, attachment.filename);
  const src = useAttachmentSource(
    pending || !image ? null : attachmentUrl({ account, messageId, attachment })
  );
  const tileRef = React.useRef<HTMLButtonElement | null>(null);
  const pdfSrc = usePdfThumbnail(
    tileRef,
    pending || !pdf ? null : attachmentUrl({ account, messageId, attachment }),
    attachment.size
  );
  // Not one still being attached to a draft: there is nothing at the provider
  // to read, so there is nothing to hand over.
  const filePath = pending
    ? null
    : attachmentUrl({ account, messageId, attachment, download: true });
  const drag = filePath
    ? attachmentDragProps({
        path: filePath,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      })
    : null;
  return (
    <button
      type="button"
      ref={tileRef}
      {...drag}
      onClick={() => {
        if (!pending) onPreview();
      }}
      onContextMenu={(e) => {
        if (!filePath) return;
        onMenu(e, { path: filePath, filename: attachment.filename, onPreview });
      }}
      title={attachment.filename}
      className="mail-light-surface w-[184px] overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-sm transition hover:border-stone-300 hover:shadow"
    >
      <div className="relative flex h-[104px] items-center justify-center bg-stone-100">
        {image && src ? (
          <img
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : image ? (
          <ImageIcon className="h-7 w-7 text-stone-300" aria-hidden />
        ) : pdfSrc ? (
          /* The page from the top, on white: a document is recognised by
             its first lines, and `cover` from the middle would show the
             middle of a page and cut off the letterhead. */
          <img
            src={pdfSrc}
            alt=""
            className="absolute inset-0 h-full w-full bg-white object-cover object-top"
          />
        ) : (
          <TypeBadge filename={attachment.filename} />
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-xs font-medium text-stone-800">
          {attachment.filename}
        </p>
        <p className="text-[11px] text-stone-400">
          {pending ? "Sending…" : formatFileSize(attachment.size)}
        </p>
      </div>
    </button>
  );
}

/**
 * What a right-click on a file offers: see it, open it, or save it.
 *
 * The tile does the first on a click, and the other two were only in the
 * preview's toolbar; a reader who knows what a file is should not have to
 * look at it to save it. Not offered for a file still on its way into a
 * draft: there is nothing at the provider to read yet.
 */
export function useAttachmentMenu(): {
  openAttachmentMenu: (
    e: React.MouseEvent,
    file: { path: string; filename: string; onPreview: () => void }
  ) => void;
  attachmentMenu: React.ReactNode;
} {
  const t = useMailT();
  const [at, setAt] = React.useState<{
    x: number;
    y: number;
    path: string;
    filename: string;
    onPreview: () => void;
  } | null>(null);
  const openAttachmentMenu = React.useCallback(
    (
      e: React.MouseEvent,
      file: { path: string; filename: string; onPreview: () => void }
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY, ...file });
    },
    []
  );
  const dismiss = React.useCallback(() => setAt(null), []);
  const attachmentMenu = at ? (
    <MenuShell x={at.x} y={at.y} label={at.filename} onDismiss={dismiss}>
      <div
        className="max-w-[min(24rem,calc(100vw-1rem))] truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={at.filename}
      >
        {at.filename}
      </div>
      <div className="mb-1 border-t border-stone-200" />
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          dismiss();
          at.onPreview();
        }}
      >
        <Eye className={MENU_ICON} aria-hidden />
        {t("previewFile")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          dismiss();
          openAttachmentOutside({ path: at.path, filename: at.filename });
        }}
      >
        <ExternalLink className={MENU_ICON} aria-hidden />
        {t("open")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          dismiss();
          void downloadAttachment({ path: at.path, filename: at.filename });
        }}
      >
        <Download className={MENU_ICON} aria-hidden />
        {t("download")}
      </button>
    </MenuShell>
  ) : null;
  return { openAttachmentMenu, attachmentMenu };
}

/** Files on a received message: uniform tiles, and a way to take them all. */
export function MessageAttachmentChips({
  account,
  messageId,
  attachments,
  onPreview,
}: {
  account: string;
  messageId: string;
  attachments: MailAttachment[];
  onPreview: (attachment: MailAttachment) => void;
}) {
  const t = useMailT();
  const [saving, setSaving] = React.useState(false);
  const { openAttachmentMenu, attachmentMenu } = useAttachmentMenu();
  if (!attachments.length) return null;
  const savable = savableAttachments(attachments);
  /*
    The bubble sizes to its words, and to these tiles: a flex row that
    wraps asks for all its tiles in one line, and the bubble grows to
    that or to the pane, whichever is less, so the files sit abreast
    rather than in one long column under a short note. Capped at three
    tiles across, which is as wide as a row of files should get.
  */
  const tiles = attachments.length + (savable.length > 1 ? 1 : 0);
  const columns = Math.min(3, Math.max(1, tiles));
  const wanted = columns * 184 + (columns - 1) * 8;
  return (
    <div
      className="mail-attachment-grid mt-1 flex flex-wrap items-start gap-2"
      style={{ maxWidth: `${wanted}px` }}
    >
      {attachments.map((att) => (
        <AttachmentTile
          key={att.attachmentId}
          account={account}
          messageId={messageId}
          attachment={att}
          onPreview={() => onPreview(att)}
          onMenu={openAttachmentMenu}
        />
      ))}
      {attachmentMenu}
      {savable.length > 1 ? (
        /* In the flow with the tiles, so it takes the gap the last row
           leaves rather than a line of its own. Where the box is too
           narrow for two tiles the files stack in one column, the gap it
           was made for does not exist, and a tile-sized button is a tile
           of empty air — the container query in mail.css folds it to a
           compact row there. */
        <button
          type="button"
          disabled={saving}
          className="mail-download-all-tile flex h-[152px] w-[184px] flex-col items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-teal-700 transition hover:bg-teal-50/60 disabled:opacity-60"
          onClick={() => {
            setSaving(true);
            void downloadAllAttachments(
              savable.map((att) => ({
                path: attachmentUrl({
                  account,
                  messageId,
                  attachment: att,
                  download: true,
                }),
                filename: att.filename,
              }))
            ).finally(() => setSaving(false));
          }}
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-5 w-5" aria-hidden />
          )}
          {saving ? t("saving") : t("downloadAll")}
        </button>
      ) : null}
    </div>
  );
}

/** Header pill → flat list of every file in the thread. */
export function ThreadAttachmentsRollup({
  account,
  items,
  onPreview,
}: {
  account: string;
  items: { messageId: string; attachment: MailAttachment }[];
  onPreview: (messageId: string, attachment: MailAttachment) => void;
}) {
  const t = useMailT();
  const [saving, setSaving] = React.useState(false);
  const { openAttachmentMenu, attachmentMenu } = useAttachmentMenu();
  if (!items.length) return null;
  const calendarOnly = items.every((item) =>
    isCalendarAttachment(item.attachment)
  );
  /*
    Everything the thread carries, in one press.

    A reader who opens this list of eight files usually wants the eight,
    and the list offered only a preview each — eight previews and eight
    saves for what is one act. The same thing the grid under a single
    message already offers, for the thread the list is about.

    Not what has yet to be sent: a file still being attached to a draft
    has no copy at the provider to fetch.
  */
  const savable = items.filter(
    (item) => !item.attachment.attachmentId.startsWith("local-")
  );
  const chipLabel = calendarOnly
    ? items.length === 1
      ? t("inviteCountOne")
      : t("inviteCountMany", { count: items.length })
    : items.length === 1
      ? t("attachmentCountOne")
      : t("attachmentCountMany", { count: items.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={chipLabel}
          aria-label={chipLabel}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50"
        >
          {calendarOnly ? (
            <Calendar className="h-3.5 w-3.5 stroke-[1.5] text-teal-700/90" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          {items.length}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="w-80 p-2">
        <div className="flex items-baseline justify-between gap-3 px-2 pb-1.5">
          <p className="text-xs font-medium text-stone-500">
            {t(calendarOnly ? "calendarInvitesInThread" : "allFilesInThread")}
          </p>
          {/* Beside the heading, not among the files: it is what to do with
              all of them, and a row of its own in the list would read as a
              ninth file. Only when there are two — with one, the file
              itself is the whole of "all". */}
          {savable.length > 1 ? (
            <button
              type="button"
              disabled={saving}
              className="shrink-0 text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-60"
              onClick={() => {
                setSaving(true);
                void downloadAllAttachments(
                  savable.map(({ messageId, attachment }) => ({
                    path: attachmentUrl({
                      account,
                      messageId,
                      attachment,
                      download: true,
                    }),
                    filename: attachment.filename,
                  }))
                ).finally(() => setSaving(false));
              }}
            >
              {saving ? t("saving") : t("downloadAll")}
            </button>
          ) : null}
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {items.map(({ messageId, attachment }) => (
            <li key={`${messageId}:${attachment.attachmentId}`}>
              <button
                type="button"
                {...(attachment.attachmentId.startsWith("local-")
                  ? null
                  : attachmentDragProps({
                      path: attachmentUrl({
                        account,
                        messageId,
                        attachment,
                        download: true,
                      }),
                      filename: attachment.filename,
                      mimeType: attachment.mimeType,
                    }))}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-stone-50"
                onClick={() => onPreview(messageId, attachment)}
                onContextMenu={(e) => {
                  if (attachment.attachmentId.startsWith("local-")) return;
                  openAttachmentMenu(e, {
                    path: attachmentUrl({
                      account,
                      messageId,
                      attachment,
                      download: true,
                    }),
                    filename: attachment.filename,
                    onPreview: () => onPreview(messageId, attachment),
                  });
                }}
              >
                <TypeBadge filename={attachment.filename} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-stone-800">
                    {attachment.filename}
                  </span>
                  <span className="block text-xs text-stone-400">
                    {formatFileSize(attachment.size)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </MailPopoverContent>
      {attachmentMenu}
    </Popover>
  );
}
