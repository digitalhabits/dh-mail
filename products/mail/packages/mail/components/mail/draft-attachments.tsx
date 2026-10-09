"use client";

/*
 * The files on a draft: the state that holds them, the chips and thumbs
 * that show them, their menu, the button that adds one, and a file pasted
 * or dropped on the composer.
 */

import * as React from "react";
import { Download, ExternalLink, Eye, FileUp, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { MENU_ICON, MENU_ITEM, MenuShell } from "@/components/mail/MenuShell";
import { hostSavesAttachments, saveAttachmentBytes } from "@/lib/mail/attachment-source";
import {
  clipboardAttachments,
  uniqueAttachmentName,
} from "@/lib/mail/clipboard-attachments";
import { dragCarriesOnlyImages } from "@/lib/mail/dragged-attachments";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import {
  ATTACH_MAX_BYTES,
  ATTACH_WARN_BYTES,
  type DraftAttachment,
  TypeBadge,
  badgeTone,
  fileExtension,
  formatFileSize,
  isImageMime,
} from "@/components/mail/attachment-files";

/** Read files into draft attachments with progress (client-side, pre-send). */
export function useDraftAttachments() {
  const [items, setItems] = React.useState<DraftAttachment[]>([]);
  const readersRef = React.useRef<Map<string, FileReader>>(new Map());

  React.useEffect(() => {
    // One Map for the life of the hook. Nothing assigns the ref again.
    const readers = readersRef.current;
    return () => {
      for (const reader of readers.values()) reader.abort();
      readers.clear();
    };
  }, []);

  const totalBytes = items.reduce((sum, a) => sum + a.size, 0);
  const ready = items.every((a) => a.contentBase64 || a.error);
  const hasError = items.some((a) => a.error);

  const remove = React.useCallback((id: string) => {
    const reader = readersRef.current.get(id);
    if (reader) {
      reader.abort();
      readersRef.current.delete(id);
    }
    setItems((current) => current.filter((a) => a.id !== id));
  }, []);

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;

    setItems((current) => {
      let running = current.reduce((s, a) => s + a.size, 0);
      const accepted: { draft: DraftAttachment; file: File }[] = [];
      for (const file of list) {
        if (running + file.size > ATTACH_MAX_BYTES) {
          toast.error(mailSay("attachmentsOverLimit"));
          break;
        }
        if (
          running + file.size > ATTACH_WARN_BYTES &&
          running <= ATTACH_WARN_BYTES
        ) {
          toast.warning(mailSay("attachmentsNearLimit"));
        }
        const id = `att-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const filename = uniqueAttachmentName(file.name || "attachment", [
          ...current.map((a) => a.filename),
          ...accepted.map((a) => a.draft.filename),
        ]);
        accepted.push({
          file,
          draft: {
            id,
            filename,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            progress: 0,
          },
        });
        running += file.size;
      }

      // Start readers after computing the next state (avoid setState side effects).
      queueMicrotask(() => {
        for (const { draft, file } of accepted) {
          const reader = new FileReader();
          readersRef.current.set(draft.id, reader);
          reader.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.round((e.loaded / e.total) * 100);
            setItems((cur) =>
              cur.map((a) => (a.id === draft.id ? { ...a, progress: pct } : a))
            );
          };
          reader.onload = () => {
            readersRef.current.delete(draft.id);
            const result =
              typeof reader.result === "string" ? reader.result : "";
            const comma = result.indexOf(",");
            const contentBase64 = comma >= 0 ? result.slice(comma + 1) : "";
            setItems((cur) =>
              cur.map((a) =>
                a.id === draft.id
                  ? { ...a, progress: null, contentBase64 }
                  : a
              )
            );
          };
          reader.onerror = () => {
            readersRef.current.delete(draft.id);
            setItems((cur) =>
              cur.map((a) =>
                a.id === draft.id
                  ? { ...a, progress: null, error: "Couldn't read file" }
                  : a
              )
            );
          };
          reader.readAsDataURL(file);
        }
      });

      return [...current, ...accepted.map((a) => a.draft)];
    });
  }, []);

  const clear = React.useCallback(() => {
    for (const reader of readersRef.current.values()) reader.abort();
    readersRef.current.clear();
    setItems([]);
  }, []);

  /** Replace the list (e.g. hydrate from a local draft). Aborts in-flight reads. */
  const replaceAll = React.useCallback((next: DraftAttachment[]) => {
    for (const reader of readersRef.current.values()) reader.abort();
    readersRef.current.clear();
    setItems(next);
  }, []);

  const payload = React.useCallback(() => {
    return items
      .filter((a) => a.contentBase64 && !a.error)
      .map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        contentBase64: a.contentBase64!,
      }));
  }, [items]);

  return {
    items,
    totalBytes,
    ready,
    hasError,
    addFiles,
    remove,
    clear,
    replaceAll,
    payload,
  };
}

/** A file on a draft, written out: the host saves it, or a link does. */
async function saveDraftAttachment(
  item: DraftAttachment,
  open: boolean
): Promise<void> {
  if (!item.contentBase64) return;
  if (hostSavesAttachments) {
    await saveAttachmentBytes({
      filename: item.filename,
      contentBase64: item.contentBase64,
      open,
    }).catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : `Couldn't save ${item.filename}`
      );
    });
    return;
  }
  const a = document.createElement("a");
  a.href = `data:${item.mimeType || "application/octet-stream"};base64,${item.contentBase64}`;
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The same menu for a file on a draft, with one more line: take it off
 * the draft. The file is on this machine already, so Open and Download
 * write the bytes the page holds rather than fetch anything. Not offered
 * while the file is still being read in, or when reading it failed.
 */
export function useDraftAttachmentMenu({
  onPreview,
  onRemove,
}: {
  onPreview?: (id: string) => void;
  onRemove: (id: string) => void;
}): {
  openDraftAttachmentMenu: (e: React.MouseEvent, item: DraftAttachment) => void;
  draftAttachmentMenu: React.ReactNode;
} {
  const t = useMailT();
  const [at, setAt] = React.useState<{
    x: number;
    y: number;
    item: DraftAttachment;
  } | null>(null);
  const openDraftAttachmentMenu = React.useCallback(
    (e: React.MouseEvent, item: DraftAttachment) => {
      if (item.progress != null || !item.contentBase64 || item.error) return;
      e.preventDefault();
      e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY, item });
    },
    []
  );
  const dismiss = React.useCallback(() => setAt(null), []);
  const draftAttachmentMenu = at ? (
    <MenuShell x={at.x} y={at.y} label={at.item.filename} onDismiss={dismiss}>
      <div
        className="max-w-[min(24rem,calc(100vw-1rem))] truncate px-3 pb-1.5 pt-1 text-xs text-stone-500"
        title={at.item.filename}
      >
        {at.item.filename}
      </div>
      <div className="mb-1 border-t border-stone-200" />
      {onPreview ? (
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM}
          onClick={() => {
            dismiss();
            onPreview(at.item.id);
          }}
        >
          <Eye className={MENU_ICON} aria-hidden />
          {t("previewFile")}
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          dismiss();
          void saveDraftAttachment(at.item, true);
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
          void saveDraftAttachment(at.item, false);
        }}
      >
        <Download className={MENU_ICON} aria-hidden />
        {t("download")}
      </button>
      <div className="my-1 border-t border-stone-200" />
      <button
        type="button"
        role="menuitem"
        className={MENU_ITEM}
        onClick={() => {
          dismiss();
          onRemove(at.item.id);
        }}
      >
        <X className={MENU_ICON} aria-hidden />
        {t("remove")}
      </button>
    </MenuShell>
  ) : null;
  return { openDraftAttachmentMenu, draftAttachmentMenu };
}

/** Compose chips between body and action bar. */
/**
 * The picture itself, for an image waiting to be sent.
 *
 * The bytes are already held as base64, because that is what the send needs,
 * so the preview is made from those rather than from the file: a draft
 * restored from storage has no file left, and gets its thumbnail all the same.
 *
 * Anything that is not an image, or is not read yet, keeps the type badge.
 */
function DraftAttachmentThumb({ item }: { item: DraftAttachment }) {
  const isImage = isImageMime(item.mimeType, item.filename);
  // Rebuilding this string on every render would copy the whole attachment
  // each time, and an attachment can be 25 MB.
  const src = React.useMemo(() => {
    if (!isImage || !item.contentBase64) return null;
    return `data:${item.mimeType};base64,${item.contentBase64}`;
  }, [isImage, item.mimeType, item.contentBase64]);

  // A file can claim to be a picture and not decode as one. Hiding the image
  // then leaves an empty square, which says less than the badge it replaced.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <TypeBadge filename={item.filename} />;
  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-stone-100">
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function DraftAttachmentChips({
  items,
  onRemove,
  onPreview,
  className,
  docked = false,
}: {
  items: DraftAttachment[];
  onRemove: (id: string) => void;
  /** Open this file in the preview. A chip without one is not clickable. */
  onPreview?: (id: string) => void;
  /** For a composer that frames the files itself, rather than ruling them off. */
  className?: string;
  /**
   * Small pills for the composer's pinned foot, in a strip right above
   * Send and beside the paperclip that added them. The cards used to sit
   * at the end of the body, where a long reply scrolled them out of view
   * and a file was attached twice for want of seeing it once.
   */
  docked?: boolean;
}) {
  const t = useMailT();
  const { openDraftAttachmentMenu, draftAttachmentMenu } =
    useDraftAttachmentMenu({ onPreview, onRemove });
  if (!items.length) return null;
  if (docked) {
    return (
      /* Two rows at most, then the strip scrolls inside itself. Five files
         wrapped to three rows and pushed the Send row out of the box. */
      <div
        className={cn(
          "flex max-h-[4.6rem] flex-wrap content-start items-center gap-1.5 overflow-y-auto",
          className
        )}
      >
        {draftAttachmentMenu}
        {items.map((att) => {
          const uploading = att.progress != null;
          const openable = Boolean(onPreview && att.contentBase64 && !att.error);
          const ext = fileExtension(att.filename);
          return (
            <div
              key={att.id}
              className={cn(
                "inline-flex h-8 max-w-[280px] items-center gap-2 rounded-full border bg-white pl-1.5 pr-1 text-xs",
                uploading ? "border-dashed border-stone-300" : "border-stone-200",
                att.error && "border-red-200 bg-red-50/40",
                openable && "cursor-pointer hover:border-stone-300"
              )}
              role={openable ? "button" : undefined}
              tabIndex={openable ? 0 : undefined}
              title={att.error ?? att.filename}
              onClick={openable ? () => onPreview?.(att.id) : undefined}
              onContextMenu={(e) => openDraftAttachmentMenu(e, att)}
              onKeyDown={
                openable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPreview?.(att.id);
                      }
                    }
                  : undefined
              }
            >
              <span
                className={cn(
                  "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-bold tracking-wide",
                  badgeTone(ext)
                )}
              >
                {uploading ? <Paperclip className="h-3 w-3" /> : ext}
              </span>
              <span className="min-w-0 truncate font-medium text-stone-800">{att.filename}</span>
              <span className="shrink-0 tabular-nums text-stone-400">
                {uploading ? `${att.progress}%` : att.error ?? formatFileSize(att.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${att.filename}`}
                title={t("remove")}
                className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(att.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 border-t border-stone-100 px-3 py-2.5",
        className
      )}
    >
      {draftAttachmentMenu}
      {items.map((att) => {
        const uploading = att.progress != null;
        const openable = Boolean(
          onPreview && att.contentBase64 && !att.error
        );
        return (
          <div
            key={att.id}
            className={cn(
              "flex min-w-[200px] max-w-[280px] items-center gap-2.5 rounded-xl border bg-white py-2 pl-2 pr-1.5",
              uploading
                ? "border-dashed border-stone-300"
                : "border-stone-200",
              att.error && "border-red-200 bg-red-50/40",
              openable && "cursor-pointer hover:border-stone-300"
            )}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : undefined}
            title={openable ? att.filename : undefined}
            onClick={openable ? () => onPreview?.(att.id) : undefined}
            onContextMenu={(e) => openDraftAttachmentMenu(e, att)}
            onKeyDown={
              openable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPreview?.(att.id);
                    }
                  }
                : undefined
            }
          >
            {uploading ? (
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500">
                <Paperclip className="h-4 w-4" />
              </span>
            ) : (
              <DraftAttachmentThumb item={att} />
            )}
            <div className="min-w-0 flex-1">
              {uploading ? (
                <>
                  <p className="truncate text-xs text-stone-600">
                    uploading… {att.progress}%
                  </p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-[width]"
                      style={{ width: `${att.progress}%` }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="truncate text-xs font-medium text-stone-800">
                    {att.filename}
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {att.error ?? formatFileSize(att.size)}
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label={`Remove ${att.filename}`}
              title={t("remove")}
              className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(att.id);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AttachToolbarButton({
  onPick,
  disabled,
  className,
  iconClassName,
}: {
  onPick: (files: FileList) => void;
  disabled?: boolean;
  /** For a composer that wants it the shape of the buttons beside it. */
  className?: string;
  /** For a composer that wants it the size of the buttons beside it. */
  iconClassName?: string;
}) {
  const t = useMailT();
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        title={t("attachFiles")}
        aria-label={t("attachFiles")}
        disabled={disabled}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40",
          className
        )}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className={cn("h-4 w-4", iconClassName)} />
      </button>
    </>
  );
}

/**
 * Files waiting to go, as pictures rather than as a list.
 *
 * A row of thumbnails, the way a messaging app shows what is about to be
 * sent. The filename and the byte count told you almost nothing about a
 * photograph and took a line each to do it; the picture is the name.
 *
 * Anything that is not a picture keeps its name, because for those the name
 * is all there is.
 */
export function DraftAttachmentThumbs({
  items,
  onRemove,
  onPreview,
}: {
  items: DraftAttachment[];
  onRemove: (id: string) => void;
  /** Open this file in the preview. A tile without one is not clickable. */
  onPreview?: (id: string) => void;
}) {
  const t = useMailT();
  const { openDraftAttachmentMenu, draftAttachmentMenu } =
    useDraftAttachmentMenu({ onPreview, onRemove });
  if (!items.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {draftAttachmentMenu}
      {items.map((att) => {
        const image = isImageMime(att.mimeType, att.filename);
        const src =
          image && att.contentBase64
            ? `data:${att.mimeType};base64,${att.contentBase64}`
            : null;
        const reading = att.progress != null;
        const openable = Boolean(
          onPreview && att.contentBase64 && !att.error
        );
        return (
          <div
            key={att.id}
            className={cn(
              "relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl border bg-stone-100",
              att.error ? "border-red-300" : "border-stone-200",
              openable && "cursor-pointer"
            )}
            title={`${att.filename} · ${formatFileSize(att.size)}`}
            role={openable ? "button" : undefined}
            tabIndex={openable ? 0 : undefined}
            onClick={openable ? () => onPreview?.(att.id) : undefined}
            onContextMenu={(e) => openDraftAttachmentMenu(e, att)}
            onKeyDown={
              openable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPreview?.(att.id);
                    }
                  }
                : undefined
            }
          >
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1">
                <TypeBadge filename={att.filename} />
                <span className="w-full truncate text-center text-[9px] leading-tight text-stone-500">
                  {att.filename}
                </span>
              </span>
            )}
            {reading ? (
              <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                <Loader2 className="h-4 w-4 animate-spin text-stone-500" />
              </span>
            ) : null}
            <button
              type="button"
              title={t("remove")}
              aria-label={`Remove ${att.filename}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(att.id);
              }}
              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-stone-900/60 text-white backdrop-blur transition-colors hover:bg-stone-900/80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AttachmentSizeSummary({
  count,
  totalBytes,
}: {
  count: number;
  totalBytes: number;
}) {
  if (!count) return null;
  const warn = totalBytes >= ATTACH_WARN_BYTES;
  return (
    <span
      className={cn(
        "text-xs",
        warn ? "font-medium text-amber-700" : "text-stone-400"
      )}
    >
      {count} file{count === 1 ? "" : "s"} · {formatFileSize(totalBytes)}
      {warn ? " · near 25 MB limit" : ""}
    </span>
  );
}

/** Full-card drop overlay while dragging files over the composer. */
export function ComposerDropOverlay({ visible }: { visible: boolean }) {
  const t = useMailT();
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-teal-50/90 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border-2 border-dashed border-teal-500 bg-white px-8 py-10 text-center shadow-sm">
        <FileUp className="h-8 w-8 text-teal-600" />
        <p className="text-sm font-medium text-stone-800">
          {t("dropToAttach")}
        </p>
      </div>
    </div>
  );
}

/**
 * Attach whatever was pasted, when it is a file.
 *
 * Bound with `onPasteCapture` rather than `onPaste`, and it stops the event.
 * The rich text editor listens on its own element, which is deeper, so a
 * bubbling handler would arrive after it had already put the image into the
 * message body as base64 — a megabyte of inline data instead of an attachment.
 *
 * A paste carrying no file is not touched, so pasting text is unaffected.
 */
/**
 * What a paste into the composer does with what it is carrying.
 *
 * A picture goes into the message where the caret is. Everything else is
 * hung off the end as a file. Pasting a screenshot and watching it land as
 * `image.png` beside the message — rather than in the sentence being written
 * about it — is the thing every other mail app gets right.
 *
 * `onImage` is optional: a composer with no editor to insert into (or one
 * that has not mounted yet) keeps the old behaviour, which is a file.
 */
export function useComposerPaste(
  onFiles: (files: File[]) => void,
  onImage?: (dataUrl: string) => boolean | void
) {
  const onPasteCapture = (event: React.ClipboardEvent) => {
    const files = clipboardAttachments(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();

    if (!onImage) {
      onFiles(files);
      return;
    }
    const images = files.filter((f) => f.type.startsWith("image/"));
    const rest = files.filter((f) => !f.type.startsWith("image/"));
    if (rest.length) onFiles(rest);
    for (const image of images) {
      // Read then insert, in the order they were pasted. A reader is async,
      // so each waits for its own — two screenshots pasted at once must not
      // land back to front.
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        // Refused — too big to write into a message, say — so it goes the
        // way it always went rather than nowhere at all.
        if (url && onImage(url) === false) onFiles([image]);
      };
      reader.onerror = () => onFiles([image]);
      reader.readAsDataURL(image);
    }
  };
  return { pasteHandlers: { onPasteCapture } };
}

/**
 * The element the message is written in, from whatever the pointer is over.
 *
 * Quill's own class, the same way both composers find the editor to focus
 * it. The body is the one region of the card where a picture goes into the
 * words rather than onto the end of the message.
 */
function overMessageBody(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element && target.closest(".ql-editor") !== null
  );
}

/** A file as a `data:` URI, or an empty string when it cannot be read. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

/**
 * What a file dragged onto the composer does.
 *
 * A picture dropped in the message goes into the message, where it was
 * dropped. The overlay stays away while it is over the words, because the
 * writer is aiming at a place in a sentence and the overlay both hides the
 * sentence and says the wrong thing about what the drop will do. Over the
 * subject, the addresses, the signature or the buttons there is no place
 * to aim at, so the overlay comes back and the picture is attached.
 *
 * Every file that is not a picture is an attachment, wherever it lands. A
 * PDF has nothing to show inside a sentence.
 *
 * `intoBody` is optional. A composer that gives none keeps the old
 * behaviour, which is to attach whatever is dropped anywhere on it.
 */
export function useComposerFileDrop(
  onFiles: (files: FileList | File[]) => void,
  intoBody?: {
    /** Move the caret to the pointer. False when it is not in the text. */
    caretToPoint: (clientX: number, clientY: number) => boolean;
    /** Write the picture in at the caret. False when it cannot go in. */
    insert: (dataUrl: string) => boolean | void;
  }
) {
  const [dragging, setDragging] = React.useState(false);
  const depth = React.useRef(0);

  /** Whether this drag goes into the words rather than onto the message. */
  const goesInline = (e: React.DragEvent) =>
    Boolean(
      intoBody &&
        overMessageBody(e.target) &&
        dragCarriesOnlyImages(e.dataTransfer.items)
    );

  const onDragEnter = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(!goesInline(e));
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    // Every move, because the pointer crosses from the words to the rest of
    // the card and back. The caret follows it while it is over the words.
    const inline = goesInline(e);
    setDragging(!inline);
    if (inline) intoBody?.caretToPoint(e.clientX, e.clientY);
  };
  const onDrop = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    const inline = goesInline(e);
    const files = [...(e.dataTransfer.files ?? [])];
    depth.current = 0;
    setDragging(false);
    if (!files.length) return;
    if (!inline || !intoBody) {
      onFiles(files);
      return;
    }
    // Where it was dropped, before anything is read: a reader is async, and
    // by the time it answers the pointer is gone.
    if (!intoBody.caretToPoint(e.clientX, e.clientY)) {
      onFiles(files);
      return;
    }
    void (async () => {
      for (const file of files) {
        const url = await readDataUrl(file);
        // Refused — too big to write into a message, say — so it goes the
        // way it always went rather than nowhere at all.
        if (!url || intoBody.insert(url) === false) onFiles([file]);
      }
    })();
  };

  return {
    dragging,
    dropHandlers: { onDragEnter, onDragLeave, onDragOver, onDrop },
  };
}
