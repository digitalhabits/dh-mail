"use client";

/**
 * A right-click on a picture in the message: copy it, or crop it.
 *
 * Drawn with inline styles, like the resize handles beside it in
 * RichTextEditor: this file is shared by the planner and the mail app, and
 * not every build's stylesheet reads the classes written here.
 *
 * Both are portalled to the page body, out of the composer. The composer
 * can sit under a CSS zoom and inside a card that clips; a menu or a crop
 * window drawn inside it would be scaled and cut off with it.
 */

import { Copy, Crop } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Point = { x: number; y: number };

/** The menu a right-click on a picture puts up. */
export function ImageContextMenu({
  at,
  onCopy,
  onCrop,
  onDismiss,
}: {
  at: Point;
  onCopy: () => void;
  onCrop: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState({ left: at.x, top: at.y });

  // Kept on screen: a right-click near the edge opens it inward.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const item = (label: string, Icon: typeof Copy, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onDismiss();
        run();
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f4")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onFocus={(e) => (e.currentTarget.style.background = "#f5f5f4")}
      onBlur={(e) => (e.currentTarget.style.background = "transparent")}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        border: 0,
        background: "transparent",
        textAlign: "left",
        fontSize: 14,
        color: "#292524",
        cursor: "default",
        outline: "none",
      }}
    >
      <Icon
        aria-hidden
        style={{ width: 14, height: 14, flexShrink: 0, color: "#78716c" }}
      />
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Picture"
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: placed.left,
        top: placed.top,
        zIndex: 80,
        minWidth: 176,
        padding: "4px 0",
        borderRadius: 8,
        border: "1px solid #e7e5e4",
        background: "#ffffff",
        boxShadow:
          "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
      }}
    >
      {item("Copy image", Copy, onCopy)}
      {item("Crop image…", Crop, onCrop)}
    </div>,
    document.body
  );
}

/**
 * The picture's pixels, in a form a canvas can read back.
 *
 * From the bytes when they can be fetched: a bitmap made from a blob never
 * taints the canvas. The desktop app's scheme may refuse a fetch, and then
 * the element on the page is drawn as it is. The same way the To-Do notes
 * copy a picture.
 */
async function readPixels(image: HTMLImageElement): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  type: string;
}> {
  try {
    const blob = await (await fetch(image.src)).blob();
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      type: blob.type,
    };
  } catch {
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      type: image.src.match(/^data:([^;,]+)/)?.[1] ?? "image/png",
    };
  }
}

/**
 * The picture, as a PNG, on the system clipboard.
 *
 * The write starts inside the click and the pixels arrive later: WebKit
 * refuses a clipboard write that starts after an `await`, and takes a
 * promise for the content in its place.
 */
export function copyImageToClipboard(image: HTMLImageElement): boolean {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  const png = (async () => {
    const { source, width, height, type } = await readPixels(image);
    if (type === "image/png" && !(source instanceof HTMLImageElement)) {
      // Already a PNG: the bytes as they are. Re-read, since the bitmap
      // has consumed the blob.
      return (await fetch(image.src)).blob();
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("no PNG"))),
        "image/png"
      )
    );
  })();
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .catch((error) => console.warn("[editor] copy image failed", error));
  return true;
}

type Rect = { x: number; y: number; w: number; h: number };
type Drag = "move" | "new" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const TEAL = "#14b8a6";

/**
 * The crop window.
 *
 * The picture, fitted to the window, with a box on it that is what will be
 * kept. Drag a corner or an edge to move that side, drag inside to move
 * the box, drag outside it to draw a new one. Enter crops, Escape leaves
 * the picture as it was.
 *
 * All sizes are kept in the picture's own pixels and only drawn scaled, so
 * the crop is cut at full resolution whatever size the window shows it at.
 */
export function ImageCropDialog({
  image,
  onCancel,
  onCrop,
}: {
  image: HTMLImageElement;
  onCancel: () => void;
  /** The cropped picture as a data: URL, and the share of the width kept. */
  onCrop: (dataUrl: string, keptWidth: number) => void;
}) {
  const natural = { w: image.naturalWidth || 1, h: image.naturalHeight || 1 };
  const [viewport, setViewport] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const scale = Math.min(
    1,
    Math.min(viewport.w - 64, 960) / natural.w,
    (viewport.h - 180) / natural.h
  );
  const shown = { w: natural.w * scale, h: natural.h * scale };
  const whole: Rect = { x: 0, y: 0, w: natural.w, h: natural.h };
  const [rect, setRect] = useState<Rect>(whole);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const changed =
    rect.x !== 0 ||
    rect.y !== 0 ||
    rect.w !== natural.w ||
    rect.h !== natural.h;

  const apply = useCallback(async () => {
    if (working) return;
    if (!changed) {
      onCancel();
      return;
    }
    setWorking(true);
    try {
      const { source, width, height, type } = await readPixels(image);
      // The bitmap and the element can disagree on size (an EXIF turn):
      // cut by share, not by pixel.
      const fx = width / natural.w;
      const fy = height / natural.h;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.w * fx));
      canvas.height = Math.max(1, Math.round(rect.h * fy));
      canvas
        .getContext("2d")
        ?.drawImage(
          source,
          rect.x * fx,
          rect.y * fy,
          rect.w * fx,
          rect.h * fy,
          0,
          0,
          canvas.width,
          canvas.height
        );
      // A photo stays a JPEG: as a PNG it would be several times the size
      // in the message.
      const dataUrl =
        type === "image/jpeg"
          ? canvas.toDataURL("image/jpeg", 0.92)
          : canvas.toDataURL("image/png");
      onCrop(dataUrl, rect.w / natural.w);
    } catch (error) {
      // A picture from another site that the page may show but not read.
      console.warn("[editor] crop failed", error);
      setFailed(true);
      setWorking(false);
    }
  }, [changed, image, natural.h, natural.w, onCancel, onCrop, rect, working]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        void apply();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [apply, onCancel]);

  const startDrag = (kind: Drag) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* a looser drag, not a dead one */
    }
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const toPicture = (clientX: number, clientY: number): Point => ({
      x: Math.min(Math.max((clientX - stage.left) / scale, 0), natural.w),
      y: Math.min(Math.max((clientY - stage.top) / scale, 0), natural.h),
    });
    const start = toPicture(event.clientX, event.clientY);
    const from = rect;
    // Never smaller than a handle can be grabbed at.
    const least = Math.min(24 / scale, natural.w, natural.h);

    const onMove = (move: PointerEvent) => {
      const at = toPicture(move.clientX, move.clientY);
      if (kind === "move") {
        const dx = at.x - start.x;
        const dy = at.y - start.y;
        setRect({
          ...from,
          x: Math.min(Math.max(from.x + dx, 0), natural.w - from.w),
          y: Math.min(Math.max(from.y + dy, 0), natural.h - from.h),
        });
        return;
      }
      if (kind === "new") {
        const x = Math.min(start.x, at.x);
        const y = Math.min(start.y, at.y);
        const w = Math.abs(at.x - start.x);
        const h = Math.abs(at.y - start.y);
        if (w >= least && h >= least) setRect({ x, y, w, h });
        return;
      }
      let left = from.x;
      let top = from.y;
      let right = from.x + from.w;
      let bottom = from.y + from.h;
      if (kind.includes("w")) left = Math.min(at.x, right - least);
      if (kind.includes("e")) right = Math.max(at.x, left + least);
      if (kind.includes("n")) top = Math.min(at.y, bottom - least);
      if (kind.includes("s")) bottom = Math.max(at.y, top + least);
      setRect({ x: left, y: top, w: right - left, h: bottom - top });
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      // Whole pixels, so the cut lands on the grid.
      setRect((r) => {
        const x = Math.round(r.x);
        const y = Math.round(r.y);
        return {
          x,
          y,
          w: Math.min(Math.round(r.w), natural.w - x),
          h: Math.min(Math.round(r.h), natural.h - y),
        };
      });
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const box = {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  };
  const handles: Array<{
    kind: Drag;
    left: string;
    top: string;
    cursor: string;
  }> = [
    { kind: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
    { kind: "n", left: "50%", top: "0%", cursor: "ns-resize" },
    { kind: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
    { kind: "e", left: "100%", top: "50%", cursor: "ew-resize" },
    { kind: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
    { kind: "s", left: "50%", top: "100%", cursor: "ns-resize" },
    { kind: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
    { kind: "w", left: "0%", top: "50%", cursor: "ew-resize" },
  ];

  const button = (primary: boolean): React.CSSProperties => ({
    padding: "7px 14px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    border: primary ? "1px solid #0f766e" : "1px solid #d6d3d1",
    background: primary ? "#0f766e" : "#ffffff",
    color: primary ? "#ffffff" : "#292524",
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop the picture"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "rgba(28,25,23,0.72)",
        userSelect: "none",
      }}
    >
      <div
        ref={stageRef}
        onPointerDown={startDrag("new")}
        style={{
          position: "relative",
          width: shown.w,
          height: shown.h,
          cursor: "crosshair",
          touchAction: "none",
          boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
        }}
      >
        {/* The dimming is clipped to the picture; the handles are not, so
            a handle on the edge is drawn whole. */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <img
            src={image.src}
            alt=""
            draggable={false}
            style={{ display: "block", width: shown.w, height: shown.h }}
          />
          <div
            onPointerDown={startDrag("move")}
            style={{
              position: "absolute",
              ...box,
              cursor: "move",
              outline: `2px solid ${TEAL}`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          >
            {/* Thirds, for placing what matters off the middle. */}
            {[1, 2].map((i) => (
              <div
                key={`v${i}`}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${(i * 100) / 3}%`,
                  width: 1,
                  background: "rgba(255,255,255,0.35)",
                }}
              />
            ))}
            {[1, 2].map((i) => (
              <div
                key={`h${i}`}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${(i * 100) / 3}%`,
                  height: 1,
                  background: "rgba(255,255,255,0.35)",
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", ...box, pointerEvents: "none" }}>
          {handles.map((h) => (
            <button
              key={h.kind}
              type="button"
              aria-label="Move this side of the crop"
              onPointerDown={startDrag(h.kind)}
              style={{
                position: "absolute",
                left: h.left,
                top: h.top,
                width: 16,
                height: 16,
                marginLeft: -8,
                marginTop: -8,
                padding: 0,
                borderRadius: 9999,
                border: `2px solid ${TEAL}`,
                background: "rgba(255,255,255,0.95)",
                cursor: h.cursor,
                pointerEvents: "auto",
                touchAction: "none",
              }}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "#e7e5e4",
        }}
      >
        <span style={{ marginRight: 8, fontVariantNumeric: "tabular-nums" }}>
          {failed
            ? "This picture cannot be cropped here."
            : `${Math.round(rect.w)} × ${Math.round(rect.h)}`}
        </span>
        {changed ? (
          <button
            type="button"
            style={button(false)}
            onClick={() => setRect(whole)}
          >
            Reset
          </button>
        ) : null}
        <button type="button" style={button(false)} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          style={{ ...button(true), opacity: working || failed ? 0.6 : 1 }}
          disabled={working || failed}
          onClick={() => void apply()}
        >
          Crop
        </button>
      </div>
    </div>,
    document.body
  );
}
