"use client";

/*
 * A file on a message or a draft, and what can be done with it: its size
 * and type, its bytes (read once and kept while shown), download and drag
 * out, and opening it in another app.
 *
 * The message's files are drawn in MailAttachments.tsx, a draft's in
 * draft-attachments.tsx, and the preview in attachment-preview.tsx.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import {
  attachmentSourceNow,
  dragAttachmentOut,
  hostDragsAttachments,
  hostSavesAttachments,
  openAttachmentSource,
  prepareAttachmentDrag,
  saveAttachment,
  startAttachmentDrag,
} from "@/lib/mail/attachment-source";
import { openExternalUrl } from "@/lib/native-shell";
import { cn } from "@/lib/utils";

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

/**
 * Video and sound the preview plays. By type, or by name when the sender's
 * mail program called the file application/octet-stream. Whether the
 * system can play one is known only when it tries: see MediaPreview.
 */
export function isVideoMime(mimeType: string, filename?: string): boolean {
  if (mimeType.startsWith("video/")) return true;
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  return Boolean(ext && ["mp4", "m4v", "mov", "webm"].includes(ext));
}

export function isAudioMime(mimeType: string, filename?: string): boolean {
  if (mimeType.startsWith("audio/")) return true;
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  return Boolean(ext && ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"].includes(ext));
}

/**
 * The largest video or sound file the preview plays. A preview reads the
 * whole file into memory first, so a film sent by mail would sit there in
 * full; past this it is offered as a download only.
 */
export const MEDIA_PREVIEW_MAX_BYTES = 100 * 1024 * 1024;

export function isPdfMime(mimeType: string, filename?: string): boolean {
  if (mimeType === "application/pdf") return true;
  return (filename ?? "").toLowerCase().endsWith(".pdf");
}

export function badgeTone(ext: string): string {
  if (ext === "PDF") return "bg-rose-100 text-rose-700";
  if (["XLS", "XLSX", "CSV"].includes(ext)) return "bg-emerald-100 text-emerald-800";
  if (["DOC", "DOCX"].includes(ext)) return "bg-sky-100 text-sky-800";
  if (["PPT", "PPTX"].includes(ext)) return "bg-orange-100 text-orange-800";
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(ext)) {
    return "bg-violet-100 text-violet-800";
  }
  return "bg-stone-100 text-stone-700";
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
 * A URL of null alone means two different things: still reading, and cannot
 * be read. So anything that waits on it waits for ever. A thumbnail can show
 * its placeholder either way. A window opened on purpose to see the file
 * cannot, and says "Loading…" until it is closed.
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
 * The pointer resting on the file is the signal to get ready — see
 * `prepareAttachmentDrag`. If the pointer going down is the only signal, a
 * file of a few megabytes is not read by the time the drag begins. The drag
 * waits for it, and a reader who lets go in that time gets nothing. Resting
 * reads the file for a drag that can never happen. That is the same reading
 * that a preview does, once per file.
 */
export function attachmentDragProps(input: {
  path: string;
  filename: string;
  mimeType: string;
}): {
  draggable: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onDragStart: (event: React.DragEvent) => void;
} {
  const stopResting = () => {
    if (restTimer) clearTimeout(restTimer);
    restTimer = null;
  };
  /*
    A desktop host drags the file itself, as soon as the pointer moves a
    few pixels with the button down. The page's own drag of a button begins
    only after the button is held for a moment, and Finder takes nothing
    from it. A browser keeps the page's drag, which is
    what puts the file on it.
  */
  const native = hostDragsAttachments;
  return {
    draggable: !native,
    onPointerEnter: () => {
      stopResting();
      restTimer = setTimeout(() => {
        restTimer = null;
        prepareAttachmentDrag(input);
      }, REST_BEFORE_READING_MS);
    },
    onPointerLeave: stopResting,
    onPointerDown: (event) => {
      stopResting();
      prepareAttachmentDrag(input);
      pressedAt = native && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerMove: (event) => {
      if (!pressedAt) return;
      if ((event.buttons & 1) === 0) {
        pressedAt = null;
        return;
      }
      const moved = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
      if (moved < DRAG_START_PX) return;
      pressedAt = null;
      dragAttachmentOut(input);
    },
    onPointerUp: () => {
      pressedAt = null;
    },
    /*
      With a native drag, the page's own is only stopped: the file's drag
      began when the pointer moved, and a second start here was refused
      while the first ran.
    */
    onDragStart: (event) => {
      if (native) event.preventDefault();
      else startAttachmentDrag(event, input);
    },
  };
}

/** How long the pointer rests on a file before it is read for a drag. */
const REST_BEFORE_READING_MS = 250;
/** How far the pointer moves with the button down before a drag starts. */
const DRAG_START_PX = 4;
/** Where the button went down on a file, while it is down and not yet a drag. */
let pressedAt: { x: number; y: number } | null = null;
/** One pointer, so one file resting at a time. */
let restTimer: ReturnType<typeof setTimeout> | null = null;

export function TypeBadge({ filename }: { filename: string }) {
  const ext = fileExtension(filename);
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-inner text-[10px] font-bold tracking-wide",
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
