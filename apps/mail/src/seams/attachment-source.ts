/**
 * Attachments, for a build with no server.
 *
 * `<img src="/api/mail/attachment?…">` is the browser fetching that URL by
 * itself, and nothing here answers it. The bytes have to be read through the
 * transport, which reaches the mail core and Gmail, and then handed to the
 * page as a `blob:` URL.
 *
 * Saving works the same way: the webview has no downloads folder, so the bytes
 * go to Rust, which writes them where the user keeps their files.
 */

import { toast } from "@/lib/mail/toast";

import { mailApiFetch } from "@/lib/mail/api";
import type { AttachmentSource } from "@/lib/mail/host/contracts";
import { bytesToBase64 } from "@/lib/base64";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/** Nothing is available until the bytes are read, so the caller has to wait. */
export function attachmentSourceNow(_path: string): string | null {
  return null;
}

/** Read the attachment through the transport, and keep it as a blob URL. */
export async function openAttachmentSource(
  path: string
): Promise<AttachmentSource> {
  const res = await mailApiFetch(path);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Couldn't read the attachment (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  return {
    url,
    // A blob URL holds its bytes until this runs. Without it, every attachment
    // ever shown stays in memory for the life of the window.
    release: () => URL.revokeObjectURL(url),
  };
}

/** A webview has no downloads folder, so this host writes the file itself. */
export const hostSavesAttachments = true;

/** Downloads on their way, by what and how: a second click joins the first. */
const inflight = new Map<string, Promise<void>>();

export async function saveAttachment(input: {
  path: string;
  filename: string;
  open?: boolean;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Saving a file needs the desktop app");

  /*
    Said at once, and done once.

    Reading a file out of the mailbox takes a moment — seconds, when the
    connection has to be opened first — and a button that does nothing
    for that long gets pressed again. Each press fetched and saved the
    file over, so the folder filled with copies. Now the first press says
    what it is doing, and the others wait for it.
  */
  const key = `${input.open ? "open" : "save"}:${input.path}`;
  const running = inflight.get(key);
  if (running) return running;
  const id = toast.loading(
    input.open ? `Opening ${input.filename}…` : `Downloading ${input.filename}…`
  );
  const job = (async () => {
    const res = await mailApiFetch(input.path);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `Couldn't read the attachment (${res.status})`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    await saveAttachmentBytes({
      filename: input.filename,
      // Base64 because the bridge carries JSON. An attachment is at most 25 MB,
      // which Gmail will not exceed, so this stays a copy and not a problem.
      contentBase64: bytesToBase64(bytes),
      open: input.open,
      toastId: id,
    });
  })()
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save the file", { id });
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Bytes the page already holds, such as a file on a draft. */
export async function saveAttachmentBytes(input: {
  filename: string;
  contentBase64: string;
  open?: boolean;
  /** A toast already up for this file, to be finished rather than joined. */
  toastId?: string | number;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Saving a file needs the desktop app");
  const saved = (await invoke("save_attachment", {
    filename: input.filename,
    contentBase64: input.contentBase64,
    open: input.open === true,
  })) as string;

  // Opening the file says where it went by itself. Saving does not, and Rust
  // may have renamed it to avoid replacing something, so name what it wrote.
  if (input.open) {
    if (input.toastId != null) toast.dismiss(input.toastId);
    return;
  }
  toast.success(
    `Saved ${fileName(saved)} to ${folder(saved)}`,
    input.toastId != null ? { id: input.toastId } : undefined
  );
}

/** The last segment of a path, and the one before it. */
function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function folder(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] || "your files";
}

/** See the same name in the mail package: both hosts answer this. */
export type AttachmentDragEvent = {
  preventDefault: () => void;
  dataTransfer: DataTransfer | null;
};

/**
 * A webview cannot hand a file to Finder, so this host does it natively.
 *
 * What a page puts on a drag is text and addresses. A file manager takes
 * files, and only the native side can put one on the drag pasteboard — see
 * dragout.rs, which writes a copy and begins a real dragging session.
 */
export const hostDragsAttachments = true;

/** The staged copy for an attachment path, or the reading that will make one. */
const staged = new Map<string, Promise<string>>();

/**
 * Read the file and write it where a drag can point at it.
 *
 * Called as the button goes down, not when the drag starts: reading a 20 MB
 * attachment out of Gmail takes long enough that a drag begun afterwards
 * would begin under a pointer that has already arrived somewhere. By
 * `dragstart` the path is usually in hand.
 *
 * The promise is kept, so the same file is read once however often it is
 * picked up. A failed read is dropped, so the next attempt tries again.
 */
export function prepareAttachmentDrag(input: {
  path: string;
  filename: string;
}): void {
  if (staged.has(input.path)) return;
  staged.set(
    input.path,
    stageAttachment(input).catch((err: unknown) => {
      staged.delete(input.path);
      throw err;
    })
  );
}

async function stageAttachment(input: {
  path: string;
  filename: string;
}): Promise<string> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Dragging a file out needs the desktop app");

  const res = await mailApiFetch(input.path);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Couldn't read the attachment (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  return (await invoke("stage_attachment_for_drag", {
    filename: input.filename,
    // Base64 for the same reason saving uses it: the bridge carries JSON.
    contentBase64: bytesToBase64(bytes),
  })) as string;
}

/**
 * Start the native drag in place of the page's own.
 *
 * `preventDefault` because the drag the page would start carries nothing a
 * file manager wants, and two drags at once is one too many.
 */
export function startAttachmentDrag(
  event: AttachmentDragEvent,
  input: { path: string; filename: string; mimeType: string }
): void {
  event.preventDefault();
  prepareAttachmentDrag(input);
  const file = staged.get(input.path);
  if (!file) return;
  void file
    .then(async (path) => {
      const invoke = tauriInvoke();
      if (!invoke) return;
      await invoke("drag_files", { paths: [path] });
    })
    .catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Couldn't drag that file out"
      );
    });
}
