/**
 * Printing the file that is open in the preview, with ⌘P.
 *
 * ⌘P printed the message under the preview, not the PDF the reader was
 * looking at (Mikkel, 2026-11-05). The preview now takes the key, and the
 * file prints through the same print panel as a message (print-mail.ts).
 *
 * The Mac prints from a web view of its own, which can read neither the
 * file's blob URL nor a PDF. So a picture goes as a `data:` URL, and a PDF
 * as one picture per page, drawn by pdf.js (renderPdfPages). Each picture
 * is one sheet of paper.
 */

import { renderPdfPages } from "@/lib/mail/attachment-text";
import { mailSay } from "@/lib/mail/i18n-strings";
import { toast } from "@/lib/mail/toast";

import { printHtmlDocument } from "@/components/mail/print-mail";

/** About 200 dots an inch across a sheet of A4 or Letter. */
const PDF_PAGE_WIDTH_PX = 1700;

/** A longer PDF prints its first pages, and says so. */
const PDF_MAX_PAGES = 60;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The document that prints a file: one picture to a sheet, as wide as the
 * paper allows and never taller than it. No margin of the page's own: a PDF
 * page has its margins drawn in already. Only `data:` pictures load.
 */
export function buildFilePrintDocument(title: string, pictures: string[]): string {
  const sheets = pictures
    .filter((src) => src.startsWith("data:image/"))
    .map((src) => `<div class="sheet"><img src="${escapeHtml(src)}" alt=""></div>`)
    .join("");
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "@page{margin:0}",
    "html,body{margin:0;padding:0;background:#fff}",
    ".sheet{width:100%;height:100vh;display:flex;align-items:flex-start;justify-content:center;break-after:page;page-break-after:always}",
    ".sheet:last-child{break-after:auto;page-break-after:auto}",
    "img{display:block;max-width:100%;max-height:100vh;object-fit:contain}",
    "</style></head><body>",
    sheets,
    "</body></html>",
  ].join("");
}

/** A blob the page holds, as a `data:` URL. */
function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsDataURL(blob);
  });
}

export type PreviewedFileKind = "pdf" | "image" | "other";

/**
 * Print the previewed file. `src` is the preview's own URL for its bytes.
 * Anything but a PDF or a picture is not printed: the reader is told to
 * open it in its own app, which is where it can be printed as it should be.
 */
export async function printPreviewedFile(input: {
  src: string | null;
  filename: string;
  kind: PreviewedFileKind;
}): Promise<void> {
  if (input.kind === "other") {
    toast.message(mailSay("printFileOpenItFirst"));
    return;
  }
  if (!input.src) {
    toast.message(mailSay("printFileNotReady"));
    return;
  }
  const id = toast.loading(mailSay("printFilePreparing", { name: input.filename }));
  try {
    let pictures: string[];
    let cut = false;
    if (input.kind === "image" && input.src.startsWith("data:image/")) {
      // A file on a draft is a data: URL already.
      pictures = [input.src];
    } else if (input.kind === "pdf") {
      const blob = await (await fetch(input.src)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const pages = await renderPdfPages(bytes, PDF_PAGE_WIDTH_PX, PDF_MAX_PAGES + 1);
      if (!pages?.length) throw new Error(mailSay("printFileCouldNotDraw"));
      cut = pages.length > PDF_MAX_PAGES;
      pictures = pages.slice(0, PDF_MAX_PAGES);
    } else {
      pictures = [await asDataUrl(await (await fetch(input.src)).blob())];
    }
    toast.dismiss(id);
    if (cut) toast.message(mailSay("printFileFirstPages", { count: PDF_MAX_PAGES }));
    printHtmlDocument(buildFilePrintDocument(input.filename, pictures));
  } catch (err) {
    toast.error(err instanceof Error ? err.message : mailSay("couldNotPrint"), { id });
  }
}
