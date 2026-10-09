/**
 * What the attachment preview needs from a mounted PDF viewer.
 *
 * Named apart from pdf.js so the web build, which never loads pdf.js, can
 * still type the seam that would return one. See `attachment-text`.
 */
export type PdfViewerHandle = {
  /** 1 fits the page to the width of the pane; 2 is twice that. */
  setZoom(zoom: number): void;
  destroy(): void;
};
