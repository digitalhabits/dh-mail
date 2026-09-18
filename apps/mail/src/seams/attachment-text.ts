/**
 * Text out of an attachment, in the webview. Only PDFs today.
 *
 * The bytes come through the transport (the same path the viewer uses) and
 * pdf.js reads them here; the text, cut at `maxChars`, is what the AI gets.
 * The bytes never leave the machine.
 */

import { mailApiFetch } from "@/lib/mail/api";
import type { PdfViewerHandle } from "@/lib/mail/pdf-viewer-types";

export const canReadAttachmentText = true;

export function isReadableAttachment(mimeType: string, filename: string): boolean {
  return mimeType === "application/pdf" || /\.pdf$/i.test(filename);
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * The legacy build. The modern one iterates a ReadableStream with
 * `for await`, which WebKit does not do, and it fails inside the webview
 * with "undefined is not a function (near '...value of readableStream')".
 * The legacy build is the same library compiled for that.
 */
async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // pdf.js also reaches for Promise.withResolvers, which older WebKit lacks.
    const P = Promise as unknown as { withResolvers?: unknown };
    if (typeof P.withResolvers !== "function") {
      P.withResolvers = function withResolvers<T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
      // The worker file ships beside the library; Vite gives it a URL.
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return mod as unknown as PdfJs;
    });
  }
  return pdfjsPromise;
}

/**
 * The strings on one page. `page.getTextContent()` reads its stream with
 * `for await`, in the legacy build too, and WebKit has no async iterator on
 * a ReadableStream: it fails with "undefined is not a function (near
 * '...value of readableStream')". So the stream is read with a reader here.
 */
async function pageText(page: {
  streamTextContent(): ReadableStream<{ items: unknown[] }>;
}): Promise<string[]> {
  const reader = page.streamTextContent().getReader();
  const out: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const item of value.items) {
      if (item && typeof item === "object" && "str" in item) out.push(String(item.str));
    }
  }
  return out;
}

export async function readAttachmentText(
  path: string,
  mimeType: string,
  opts: { maxChars?: number } = {}
): Promise<string | null> {
  if (!isReadableAttachment(mimeType, path)) return null;
  const maxChars = opts.maxChars ?? 20_000;
  const res = await mailApiFetch(path);
  if (!res.ok) throw new Error(`Couldn't read the attachment (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes }).promise;
  const parts: string[] = [];
  let total = 0;
  for (let n = 1; n <= doc.numPages && total < maxChars; n += 1) {
    const page = await doc.getPage(n);
    const line = (await pageText(page)).join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) {
      parts.push(line);
      total += line.length + 1;
    }
  }
  await doc.destroy();
  const text = parts.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[cut]` : text;
}

/**
 * pdf.js's own viewer, for the attachment preview.
 *
 * The browser's viewer in a frame decides its own size and, in a WKWebView
 * with page magnification off, answers no pinch at all. pdf.js's viewer is
 * DOM in this page: its pages lay out in the pane's scroller, its text can be
 * selected, and its scale is a number the preview sets from the pinch.
 */
export const canRenderPdf = true;

/**
 * The first page of a PDF, drawn small, as a data URL.
 *
 * The tile beside a message shows a picture when the file is one; a PDF
 * showed a red badge saying PDF, which the file name had already said. The
 * library that draws the preview draws this too, at the width the tile is,
 * and the picture is what the reader recognises the document by.
 *
 * Null rather than a throw on anything that goes wrong: a tile that cannot
 * draw its page is a tile with a badge on it, which is where it started.
 */
/** Long enough for a big page, short enough not to hold a file for ever. */
const PDF_THUMBNAIL_TIMEOUT_MS = 10_000;

export async function renderPdfThumbnail(
  bytes: Uint8Array,
  widthPx: number
): Promise<string | null> {
  /*
    Bounded end to end, because any step of this can fail to answer.

    Opening a document goes through pdf.js's worker and drawing a page
    goes back through it, and a worker that does not come up leaves the
    promise pending for ever — with the whole file held behind it, for a
    picture the size of a stamp. Given up on, the tile wears its badge,
    which is what it did before there were pictures at all.
  */
  return Promise.race([
    drawFirstPage(bytes, widthPx),
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.warn("mail: gave up drawing the first page of a PDF");
        resolve(null);
      }, PDF_THUMBNAIL_TIMEOUT_MS)
    ),
  ]);
}

async function drawFirstPage(
  bytes: Uint8Array,
  widthPx: number
): Promise<string | null> {
  try {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: bytes }).promise;
    try {
      const page = await doc.getPage(1);
      const unscaled = page.getViewport({ scale: 1 });
      // Drawn at the device's own pixels, so it is not soft on a retina
      // screen — and capped, because this is a thumbnail and a poster-sized
      // page would otherwise be rendered at poster size to be shrunk.
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      const scale = Math.min((widthPx * ratio) / unscaled.width, 4);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) return null;
      // A PDF page is transparent where nothing is drawn, and a thumbnail
      // of white paper is what the reader expects to see.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return canvas.toDataURL("image/png");
    } finally {
      // The worker holds the whole document until this runs.
      void doc.destroy();
    }
  } catch (err) {
    console.warn("mail: could not draw the first page of a PDF", err);
    return null;
  }
}

export async function mountPdfViewer(
  container: HTMLElement,
  bytes: Uint8Array
): Promise<PdfViewerHandle | null> {
  // In this order, and not in a Promise.all: the viewer module reads the
  // library off `globalThis.pdfjsLib` as it evaluates — it is built to be
  // loaded after a <script> tag, not imported beside one — so a concurrent
  // import fails with "Cannot destructure property 'AbortException' of
  // 'globalThis.pdfjsLib'", the preview falls back to the browser's own
  // viewer, and with it goes the zoom this exists for.
  const lib = await pdfjs();
  (globalThis as unknown as { pdfjsLib?: unknown }).pdfjsLib = lib;
  const web = await import("pdfjs-dist/web/pdf_viewer.mjs");
  await import("pdfjs-dist/web/pdf_viewer.css");
  // The viewer insists on an absolutely positioned scroller with one child
  // to fill; both are made here so the caller only provides the box.
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.overflow = "auto";
  const inner = document.createElement("div");
  inner.className = "pdfViewer";
  container.replaceChildren(inner);

  const eventBus = new web.EventBus();
  const linkService = new web.PDFLinkService({ eventBus });
  const viewer = new web.PDFViewer({
    container: container as HTMLDivElement,
    eventBus,
    linkService,
  });
  linkService.setViewer(viewer);
  const doc = await lib.getDocument({ data: bytes }).promise;
  viewer.setDocument(doc);
  linkService.setDocument(doc, null);

  // Zoom 1 is the page fitted to the width. The scale that means is read
  // back once the pages are laid out, and again whenever the pane changes
  // width while the reader is at 1 — a wider window is a wider page.
  let zoom = 1;
  let fitScale = 1;
  const apply = () => {
    if (zoom === 1) {
      viewer.currentScaleValue = "page-width";
      fitScale = viewer.currentScale;
    } else {
      viewer.currentScale = fitScale * zoom;
    }
  };
  eventBus.on("pagesinit", apply);
  const observer = new ResizeObserver(() => {
    if (zoom === 1) apply();
  });
  observer.observe(container);

  return {
    setZoom(next) {
      zoom = next;
      if (viewer.pagesCount) apply();
    },
    destroy() {
      observer.disconnect();
      viewer.cleanup();
      void doc.destroy();
      container.replaceChildren();
    },
  };
}
