"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  ImageIcon,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { MENU_ICON, MENU_ITEM, MenuShell } from "@/components/mail/MenuShell";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { MAIL_PINCH_SCALE_EVENT, readMailPinch } from "@/lib/mail/pinch";
import {
  canRenderPdf,
  mountPdfViewer,
  renderPdfThumbnail,
} from "@/lib/mail/attachment-text";
import type { PdfViewerHandle } from "@/lib/mail/pdf-viewer-types";
import {
  attachmentSourceNow,
  hostSavesAttachments,
  openAttachmentSource,
  prepareAttachmentDrag,
  saveAttachment,
  saveAttachmentBytes,
  startAttachmentDrag,
} from "@/lib/mail/attachment-source";
import {
  clipboardAttachments,
  uniqueAttachmentName,
} from "@/lib/mail/clipboard-attachments";
import { dragCarriesOnlyImages } from "@/lib/mail/dragged-attachments";
import { isCalendarAttachment } from "@/lib/mail/ics";
import { openExternalUrl } from "@/lib/native-shell";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import type { MailAttachment } from "@/lib/mail/types";

/** Soft warn before Gmail’s ~25 MB raw-message ceiling. */
export const ATTACH_WARN_BYTES = 20 * 1024 * 1024;
export const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

export type DraftAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** 0–100 while reading; null once ready (or on error). */
  progress: number | null;
  contentBase64?: string;
  error?: string;
};

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function fileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 5);
}

export function isImageMime(mimeType: string, filename?: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  return Boolean(ext && ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext));
}

export function isPdfMime(mimeType: string, filename?: string): boolean {
  if (mimeType === "application/pdf") return true;
  return (filename ?? "").toLowerCase().endsWith(".pdf");
}

function badgeTone(ext: string): string {
  if (ext === "PDF") return "bg-rose-100 text-rose-700";
  if (["XLS", "XLSX", "CSV"].includes(ext)) return "bg-emerald-100 text-emerald-800";
  if (["DOC", "DOCX"].includes(ext)) return "bg-sky-100 text-sky-800";
  if (["PPT", "PPTX"].includes(ext)) return "bg-orange-100 text-orange-800";
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(ext)) {
    return "bg-violet-100 text-violet-800";
  }
  return "bg-stone-100 text-stone-700";
}

export function attachmentUrl(opts: {
  account: string;
  messageId: string;
  attachment: MailAttachment;
  download?: boolean;
}): string {
  const params = new URLSearchParams({
    account: opts.account,
    messageId: opts.messageId,
    attachmentId: opts.attachment.attachmentId,
    filename: opts.attachment.filename,
    mimeType: opts.attachment.mimeType,
  });
  if (opts.download) params.set("download", "1");
  return `/api/mail/attachment?${params.toString()}`;
}

/**
 * A URL for this attachment that the browser can load, or null while it is
 * being fetched or when it failed.
 *
 * Pass null for `path` when there is nothing to load yet, so a caller does not
 * have to break the rules of hooks to skip it.
 */
export type AttachmentSourceState = {
  url: string | null;
  /** Why it could not be read, or null while it is still being read. */
  error: string | null;
};

/**
 * The same, with the reason it failed.
 *
 * A URL of null used to mean two different things — still reading, and could
 * not be read — so anything waiting on one waited for ever. A thumbnail can
 * live with that and show its placeholder either way; a window opened on
 * purpose to see the file cannot, and said "Loading…" until it was closed.
 */
export function useAttachmentSourceState(
  path: string | null
): AttachmentSourceState {
  // Seeded, so a host that already has the URL never renders a loading state.
  const [state, setState] = React.useState<AttachmentSourceState>(() => ({
    url: path ? attachmentSourceNow(path) : null,
    error: null,
  }));

  React.useEffect(() => {
    if (!path) {
      setState({ url: null, error: null });
      return;
    }
    const immediate = attachmentSourceNow(path);
    if (immediate) {
      setState({ url: immediate, error: null });
      return;
    }
    let live = true;
    let opened: { release: () => void } | null = null;
    setState({ url: null, error: null });
    void (async () => {
      try {
        const source = await openAttachmentSource(path);
        // Releasing here as well: the effect can be torn down mid-fetch, and
        // the cleanup below has already run by then.
        if (!live) {
          source.release();
          return;
        }
        opened = source;
        setState({ url: source.url, error: null });
      } catch (err) {
        // Said out loud, both to the reader and to the console. A silent
        // catch here is how an attachment that the provider refused looks
        // exactly like one that is still on its way.
        console.warn("mail: could not read an attachment", err);
        if (live) {
          setState({
            url: null,
            error:
              err instanceof Error ? err.message : "Couldn't read this file",
          });
        }
      }
    })();
    return () => {
      live = false;
      opened?.release();
      setState({ url: null, error: null });
    };
  }, [path]);

  return state;
}

export function useAttachmentSource(path: string | null): string | null {
  return useAttachmentSourceState(path).url;
}

/**
 * Props for a download link that works on every host.
 *
 * A browser downloads the linked path by itself, and nothing here improves on
 * that. A desktop host has no downloads folder in the webview, so it takes the
 * click and writes the file.
 */
export function attachmentDownloadProps(input: {
  path: string;
  filename: string;
}): {
  href: string;
  download: string;
  onClick: (event: React.MouseEvent) => void;
} {
  return {
    href: input.path,
    download: input.filename,
    onClick: (event) => {
      event.stopPropagation();
      if (!hostSavesAttachments) return;
      event.preventDefault();
      void saveAttachment(input).catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save the file"
        );
      });
    },
  };
}

/**
 * What makes one file draggable out of the window and into a folder.
 *
 * A file on a message is a file: the reader who wants it in a folder should
 * be able to take it there, rather than save it to Downloads and then move
 * it. What that takes differs by host, so the work is behind the seam and
 * the tiles and rows here only say which file they are showing.
 *
 * The pointer going down is the signal to get ready — see
 * `prepareAttachmentDrag`. It fires on a plain click too, which reads the
 * file for a drag that never happens; that is the same reading a preview
 * does, and it is what makes the drag itself start on time.
 */
export function attachmentDragProps(input: {
  path: string;
  filename: string;
  mimeType: string;
}): {
  draggable: boolean;
  onPointerDown: () => void;
  onDragStart: (event: React.DragEvent) => void;
} {
  return {
    draggable: true,
    onPointerDown: () => prepareAttachmentDrag(input),
    onDragStart: (event) => startAttachmentDrag(event, input),
  };
}

/** Read files into draft attachments with progress (client-side, pre-send). */
export function useDraftAttachments() {
  const [items, setItems] = React.useState<DraftAttachment[]>([]);
  const readersRef = React.useRef<Map<string, FileReader>>(new Map());

  React.useEffect(() => {
    return () => {
      for (const reader of readersRef.current.values()) reader.abort();
      readersRef.current.clear();
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

export function TypeBadge({ filename }: { filename: string }) {
  const ext = fileExtension(filename);
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tracking-wide",
        badgeTone(ext)
      )}
    >
      {ext}
    </span>
  );
}

/**
 * Open an attachment outside the message view.
 *
 * A browser can be sent to the path, because a server answers it. A host that
 * has no server saves the file first and opens that, which is what a desktop
 * user expects anyway.
 */
export function openAttachmentOutside(input: {
  path: string;
  filename: string;
}): void {
  if (hostSavesAttachments) {
    // The host says what went wrong itself, on the toast it put up when
    // the request began; a second toast here said it twice.
    void saveAttachment({ ...input, open: true }).catch(() => undefined);
    return;
  }
  void openExternalUrl(new URL(input.path, window.location.origin).toString());
}

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
          // eslint-disable-next-line @next/next/no-img-element
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
          // eslint-disable-next-line @next/next/no-img-element
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
 * Save every file on this message, one after another.
 *
 * A message with five files is a message where the reader wants all five,
 * and clicking through five previews to save each is the sort of work an
 * app is for. Sequential rather than at once: each save writes a file, and
 * a browser refuses a burst of downloads as a popup.
 */
async function downloadAllAttachments(
  items: { path: string; filename: string }[]
): Promise<void> {
  for (const item of items) {
    await downloadAttachment(item);
    await new Promise((r) => window.setTimeout(r, 150));
  }
}

/** Save one file: the host writes it, or the browser downloads it. */
async function downloadAttachment(item: {
  path: string;
  filename: string;
}): Promise<void> {
  if (hostSavesAttachments) {
    // The host's own toast carries the error; see openAttachmentOutside.
    await saveAttachment(item).catch(() => undefined);
    return;
  }
  const a = document.createElement("a");
  a.href = item.path;
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  const savable = attachments.filter(
    (a) => !a.attachmentId.startsWith("local-")
  );
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

/** Lightbox / PDF viewer / download fallback for a received attachment. */
export function AttachmentPreviewDialog({
  account,
  messageId,
  attachment,
  siblings,
  onSelect,
  onClose,
}: {
  account: string;
  messageId: string;
  attachment: MailAttachment | null;
  /** The message's other files, for stepping through without closing. */
  siblings?: MailAttachment[];
  onSelect?: (attachment: MailAttachment) => void;
  onClose: () => void;
}) {
  /*
    One file, or a walk through the message's files: with siblings and a
    way to choose, the arrows and the arrow keys step through them, the
    way every viewer of a message with three screenshots is expected to.
  */
  const index =
    attachment && siblings
      ? siblings.findIndex((a) => a.attachmentId === attachment.attachmentId)
      : -1;
  const canStep = Boolean(onSelect && siblings && siblings.length > 1);
  const step = React.useCallback(
    (by: number) => {
      if (!canStep || !siblings || index < 0) return;
      const next = siblings[(index + by + siblings.length) % siblings.length];
      onSelect?.(next);
    },
    [canStep, siblings, index, onSelect]
  );

  React.useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachment, onClose, step]);

  if (!attachment) return null;
  return (
    <>
      <AttachmentPreviewBody
        account={account}
        messageId={messageId}
        attachment={attachment}
        onClose={onClose}
      />
      {canStep ? (
        <PreviewStepChrome
          index={index}
          count={siblings?.length ?? 0}
          step={step}
        />
      ) : null}
    </>
  );
}

/**
 * The arrows, and the "2 / 5" that says where the walk is.
 *
 * Drawn over the dark margin the preview leaves round the document, on both
 * sides, where every image viewer puts them.
 */
function PreviewStepChrome({
  index,
  count,
  step,
}: {
  index: number;
  count: number;
  step: (by: number) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Previous file"
        className="fixed left-3 top-1/2 z-[90] -translate-y-1/2 rounded-full bg-stone-900/50 p-2 text-white hover:bg-stone-900/70"
        onClick={(e) => {
          e.stopPropagation();
          step(-1);
        }}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Next file"
        className="fixed right-3 top-1/2 z-[90] -translate-y-1/2 rounded-full bg-stone-900/50 p-2 text-white hover:bg-stone-900/70"
        onClick={(e) => {
          e.stopPropagation();
          step(1);
        }}
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
      <span className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-stone-900/50 px-2.5 py-0.5 text-xs text-white">
        {index + 1} / {count}
      </span>
    </>
  );
}

/**
 * The same preview, for a file that is still being written into a draft.
 *
 * A draft attachment's bytes are already in memory — the strip read them to
 * send them — so the preview is a data URL and no host seam is involved.
 * Open and Download make no sense for a file the writer just picked off
 * their own disk, so the body hides them.
 */
export function DraftAttachmentPreviewDialog({
  items,
  previewId,
  onSelect,
  onClose,
}: {
  items: DraftAttachment[];
  previewId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const openable = items.filter((a) => a.contentBase64 && !a.error);
  const index = previewId
    ? openable.findIndex((a) => a.id === previewId)
    : -1;
  const item = index >= 0 ? openable[index] : null;
  const step = React.useCallback(
    (by: number) => {
      if (index < 0 || openable.length < 2) return;
      onSelect(openable[(index + by + openable.length) % openable.length].id);
    },
    [index, openable, onSelect]
  );

  React.useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose, step]);

  // Rebuilt only when the file changes: the string copies the whole file.
  const localSrc = React.useMemo(
    () =>
      item ? `data:${item.mimeType};base64,${item.contentBase64}` : null,
    [item]
  );

  if (!item || !localSrc) return null;
  return (
    <>
      <AttachmentPreviewBody
        account=""
        messageId=""
        attachment={{
          attachmentId: item.id,
          filename: item.filename,
          mimeType: item.mimeType,
          size: item.size,
        }}
        localSrc={localSrc}
        onClose={onClose}
      />
      {openable.length > 1 ? (
        <PreviewStepChrome index={index} count={openable.length} step={step} />
      ) : null}
    </>
  );
}

/** How far the preview zooms, either way. Wide, because a scan is small. */
const PREVIEW_MIN_ZOOM = 0.5;
const PREVIEW_MAX_ZOOM = 4;

function clampPreviewZoom(zoom: number): number {
  return Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, zoom));
}

/**
 * The next round size up or down: 50, 67, 80, 90, 100, 110, 125, 150, 175,
 * 200, 250, 300, 400. The stops a browser uses, so they feel familiar.
 */
const PREVIEW_ZOOM_STOPS = [
  0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];
function nextPreviewZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return PREVIEW_ZOOM_STOPS.find((s) => s > zoom + 0.001) ?? PREVIEW_MAX_ZOOM;
  }
  return (
    [...PREVIEW_ZOOM_STOPS].reverse().find((s) => s < zoom - 0.001) ??
    PREVIEW_MIN_ZOOM
  );
}

function AttachmentPreviewBody({
  account,
  messageId,
  attachment,
  localSrc,
  onClose,
}: {
  account: string;
  messageId: string;
  attachment: MailAttachment;
  /**
   * Bytes already in hand, as a URL the browser can load. Set for a draft
   * attachment, whose file never came from a mailbox; the host seam and
   * the Open / Download row both stand down.
   */
  localSrc?: string;
  onClose: () => void;
}) {
  const t = useMailT();
  const sourceState = useAttachmentSourceState(
    localSrc ? null : attachmentUrl({ account, messageId, attachment })
  );
  const src = localSrc ?? sourceState.url;
  const error = localSrc ? null : sourceState.error;
  const download = attachmentDownloadProps({
    path: attachmentUrl({ account, messageId, attachment, download: true }),
    filename: attachment.filename,
  });
  const image = isImageMime(attachment.mimeType, attachment.filename);
  const pdf = isPdfMime(attachment.mimeType, attachment.filename);

  /**
   * How big the document is shown. 1 is fit: a picture at its natural size
   * (or shrunk to fit), a PDF at the width of the pane.
   *
   * Three ways to change it, because people arrive with different hands: a
   * pinch on the trackpad or Ctrl+scroll on a mouse (both reach the page as
   * a wheel event with ctrlKey set), Cmd+Plus and Cmd+Minus, and the −/+ in
   * the header. A pinch is continuous, so it moves the zoom by the gesture
   * rather than to the next stop; the keys and buttons step.
   */
  const [zoom, setZoom] = React.useState(1);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  /**
   * Drawn here when the host has pdf.js (the desktop app), so the pages
   * answer the zoom. Otherwise the browser's own viewer, in a frame, which
   * sizes itself. Falls back to that frame as well if pdf.js cannot open
   * the file — a viewer that fails is worse than one that cannot zoom.
   */
  const [pdfDrawFailed, setPdfDrawFailed] = React.useState(false);
  React.useEffect(() => {
    setPdfDrawFailed(false);
  }, [attachment.attachmentId]);
  const drawPdf = pdf && canRenderPdf && !pdfDrawFailed;
  const zoomable = image || drawPdf;
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const pdfBoxRef = React.useRef<HTMLDivElement>(null);
  const pdfViewerRef = React.useRef<PdfViewerHandle | null>(null);
  const [pdfReady, setPdfReady] = React.useState(false);

  // pdf.js's viewer, mounted into the box once the bytes are here.
  React.useEffect(() => {
    if (!drawPdf || !src) return;
    const box = pdfBoxRef.current;
    if (!box) return;
    let live = true;
    setPdfReady(false);
    void (async () => {
      try {
        const res = await fetch(src);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!live) return;
        const handle = await mountPdfViewer(box, bytes);
        if (!handle) throw new Error("no viewer");
        if (!live) {
          handle.destroy();
          return;
        }
        pdfViewerRef.current = handle;
        handle.setZoom(zoomRef.current);
        setPdfReady(true);
      } catch (err) {
        console.warn("mail: pdf.js could not show the attachment", err);
        if (live) setPdfDrawFailed(true);
      }
    })();
    return () => {
      live = false;
      pdfViewerRef.current?.destroy();
      pdfViewerRef.current = null;
    };
  }, [drawPdf, src]);

  React.useEffect(() => {
    pdfViewerRef.current?.setZoom(zoom);
  }, [zoom]);

  React.useEffect(() => {
    setZoom(1);
  }, [attachment.attachmentId]);

  React.useEffect(() => {
    /**
     * The pinch arrives three ways, the same three the thread pane handles
     * in `usePinchZoom`: as a wheel with Ctrl (Chromium, and a mouse wheel
     * with Ctrl or Cmd held on any engine); as WebKit's gesture events in a
     * browser; and in the desktop app as `mail-pinch-scale`, which native
     * code sends because WKWebView swallows the gesture itself.
     *
     * All three are taken over for as long as the preview is up — whether
     * or not this file is one that zooms. A pinch over a document the
     * preview cannot scale must do nothing; what it did instead was reach
     * the thread underneath and resize a message nobody could see.
     */
    const byRatio = (ratio: number) => {
      // Swallowed either way; only a zoomable file is actually scaled.
      if (!zoomable) return;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      setZoom((z) => clampPreviewZoom(z * ratio));
    };
    const onWheel = (event: WheelEvent) => {
      // Ctrl only — what a pinch reports. Cmd and the wheel is a binding
      // the reader has twice over already; see usePinchZoom.
      if (!event.ctrlKey) return;
      // Ours, not the window's: without this WebKit zooms the whole page.
      event.preventDefault();
      event.stopImmediatePropagation();
      // A pinch reports small deltas many times a second; a mouse wheel with
      // Ctrl held reports big ones rarely. The step is scaled to the delta
      // and capped, which makes the mouse feel like a slower pinch instead
      // of a jump.
      byRatio(1 + Math.max(-0.25, Math.min(0.25, -event.deltaY * 0.01)));
    };
    const onScale = (event: Event) => {
      event.stopImmediatePropagation();
      byRatio(readMailPinch(event).value);
    };
    let gestureScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      gestureScale = (event as Event & { scale?: number }).scale ?? 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const scale = (event as Event & { scale?: number }).scale ?? 1;
      if (gestureScale > 0) byRatio(scale / gestureScale);
      gestureScale = scale;
    };
    // Capture, and first where the engine orders it so; the thread pane's
    // own listeners are on the window too, and they also stand down while
    // `data-mail-preview-zoom` is in the document (see usePinchZoom), so
    // the order does not decide it.
    const opts: AddEventListenerOptions = { capture: true, passive: false };
    window.addEventListener("wheel", onWheel, opts);
    window.addEventListener(MAIL_PINCH_SCALE_EVENT, onScale, true);
    window.addEventListener("gesturestart", onGestureStart, opts);
    window.addEventListener("gesturechange", onGestureChange, opts);
    return () => {
      window.removeEventListener("wheel", onWheel, opts);
      window.removeEventListener(MAIL_PINCH_SCALE_EVENT, onScale, true);
      window.removeEventListener("gesturestart", onGestureStart, opts);
      window.removeEventListener("gesturechange", onGestureChange, opts);
    };
  }, [zoomable]);

  React.useEffect(() => {
    if (!zoomable) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((z) => nextPreviewZoom(z, 1));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((z) => nextPreviewZoom(z, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    // Capture, so this wins over the page's own Cmd+Plus (the text size)
    // while the preview is up.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomable]);

  const zoomPill = zoomable && src ? (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-200 bg-white px-1.5 py-0.5">
      <button
        type="button"
        aria-label={t("zoomOut")}
        title={`${t("zoomOut")} (⌘−)`}
        className="rounded-full px-1 text-[15px] leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
        disabled={zoom <= PREVIEW_MIN_ZOOM}
        onClick={() => setZoom((z) => nextPreviewZoom(z, -1))}
      >
        −
      </button>
      <button
        type="button"
        title={`${t("backTo100")} (⌘0)`}
        className="min-w-[3.25rem] px-1 text-center text-xs tabular-nums text-stone-600 hover:text-stone-900"
        onClick={() => setZoom(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label={t("zoomIn")}
        title={`${t("zoomIn")} (⌘+)`}
        className="rounded-full px-1 text-[15px] leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
        disabled={zoom >= PREVIEW_MAX_ZOOM}
        onClick={() => setZoom((z) => nextPreviewZoom(z, 1))}
      >
        +
      </button>
    </div>
  ) : null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-stone-900/70"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      data-mail-preview-zoom={zoomable ? "" : undefined}
      onClick={onClose}
    >
      {/* Most of the window. This is where a document is read, and a document
          is read at the size of the screen, not in a card in the middle of it
          — but with enough of the mail showing round it to say where you are. */}
      <div
        className="absolute inset-10 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
            {attachment.filename}
          </p>
          {zoomPill}
          {/* A way through that does not depend on the frame below.
              On the desktop app the file is written out and handed to
              whatever the reader opens PDFs with. */}
          {localSrc ? null : (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                onClick={() =>
                  openAttachmentOutside({
                    path: attachmentUrl({
                      account,
                      messageId,
                      attachment,
                      download: true,
                    }),
                    filename: attachment.filename,
                  })
                }
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("open")}
              </button>
              <a
                {...download}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
              >
                <Download className="h-3.5 w-3.5" />
                {t("download")}
              </a>
            </>
          )}
          <button
            type="button"
            aria-label={t("close")}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-auto bg-stone-50"
        >
          {(image || pdf) && !src && !error ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">
              {t("loading")}
            </div>
          ) : image && src ? (
            // The picture sits centred while it fits, and scrolls from its
            // top-left corner once it does not — the same as a browser tab.
            <div
              className={
                zoom <= 1
                  ? "flex h-full w-full items-center justify-center p-4"
                  : "flex min-h-full min-w-full p-4"
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={attachment.filename}
                className={cn(
                  "select-none",
                  zoom <= 1 && "max-h-full max-w-full object-contain"
                )}
                style={
                  zoom > 1
                    ? { width: `${zoom * 100}%`, height: "auto", maxWidth: "none" }
                    : { transform: zoom < 1 ? `scale(${zoom})` : undefined }
                }
                draggable={false}
              />
            </div>
          ) : drawPdf && src ? (
            // pdf.js positions its scroller absolutely, so the box is the
            // relative frame it fills.
            <div className="relative h-full w-full">
              <div ref={pdfBoxRef} />
              {!pdfReady ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-stone-400">
                  {t("opening")}
                </div>
              ) : null}
            </div>
          ) : pdf && src ? (
            <iframe
              title={attachment.filename}
              src={src}
              className="block h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <TypeBadge filename={attachment.filename} />
              <div>
                <p className="text-sm font-medium text-stone-800">
                  {attachment.filename}
                </p>
                {/* Why there is nothing to look at. "Preview not available"
                    is right for a file we were never going to show; it is a
                    lie about one the provider refused to hand over. */}
                <p className="mt-1 text-xs text-stone-500">
                  {formatFileSize(attachment.size)} ·{" "}
                  {error ?? "preview not available"}
                </p>
              </div>
              <a
                {...download}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
              >
                <Download className="h-4 w-4" />
                  {t("download")}
                </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
              // eslint-disable-next-line @next/next/no-img-element
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
