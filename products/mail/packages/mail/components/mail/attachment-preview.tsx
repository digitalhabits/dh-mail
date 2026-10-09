"use client";

/*
 * The preview of a file, from a message or a draft: a picture, a PDF or
 * text, with zoom and a step to the next file.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { MAIL_PINCH_SCALE_EVENT, readMailPinch } from "@/lib/mail/pinch";
import { canRenderPdf, mountPdfViewer } from "@/lib/mail/attachment-text";
import type { PdfViewerHandle } from "@/lib/mail/pdf-viewer-types";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import type { MailAttachment } from "@/lib/mail/types";
import {
  type DraftAttachment,
  TypeBadge,
  attachmentDownloadProps,
  formatFileSize,
  isImageMime,
  isPdfMime,
  openAttachmentOutside,
  useAttachmentSourceState,
} from "@/components/mail/attachment-files";

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
