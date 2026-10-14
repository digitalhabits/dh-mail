/**
 * Copy and save a picture from a message: the two lines a right-click on a
 * picture adds to the link menu (see `LinkContextMenu` in email-frame.tsx).
 *
 * A picture's `src` is the app's own image channel (`dhmail://…`, see
 * images.rs), a `data:` address for a picture sent inside the mail, or a
 * `blob:`. All three are read with `fetch` from the window.
 */

import { saveAttachmentBytes } from "@/lib/mail/attachment-source";

/** The picture's bytes. */
async function imageBlob(src: string): Promise<Blob> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`The picture could not be read (${res.status})`);
  return res.blob();
}

/**
 * The picture as PNG. The clipboard takes PNG everywhere, and not every
 * other type: a JPEG or GIF is drawn once and written out again as PNG.
 */
async function pngBlob(src: string): Promise<Blob> {
  const blob = await imageBlob(src);
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("The picture could not be copied"))), "image/png")
  );
}

/**
 * Put the picture on the clipboard. The clipboard item is given a promise
 * so the write starts inside the click: WebKit refuses a clipboard write
 * that starts after an `await`.
 */
export async function copyImage(src: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob(src) })]);
    return true;
  } catch {
    return false;
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * A file name for the picture: the last part of its own address where it
 * has one (the image channel carries the sender's address, base64url), else
 * "image", with an extension that matches what the bytes are.
 */
export function imageFileName(src: string, type: string): string {
  let base = "image";
  try {
    const url = new URL(src);
    let remote = "";
    if (url.protocol === "dhmail:" || url.hostname === "dhmail.localhost") {
      const coded = url.pathname.replace(/^\/+/, "").replace(/-/g, "+").replace(/_/g, "/");
      remote = atob(coded + "=".repeat((4 - (coded.length % 4)) % 4));
    } else if (/^https?:$/.test(url.protocol)) {
      remote = src;
    }
    const last = remote ? new URL(remote).pathname.split("/").filter(Boolean).pop() : "";
    if (last) base = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "") || base;
  } catch {
    /* no name to be had: "image" */
  }
  const ext = EXTENSIONS[type] ?? "png";
  return `${base.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.${ext}`;
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Save the picture to Downloads, as a file on a message is saved. */
export async function downloadImage(src: string): Promise<void> {
  const blob = await imageBlob(src);
  await saveAttachmentBytes({
    filename: imageFileName(src, blob.type),
    contentBase64: await base64Of(blob),
  });
}
