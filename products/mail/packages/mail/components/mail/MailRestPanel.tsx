"use client";

/**
 * What fills the reading pane before a conversation is chosen.
 *
 * The pane stays deliberately quiet — no message is put in front of you when
 * the app opens. This gives that quiet somewhere to rest: a picture and a
 * line, both the reader's own, and both editable in place.
 *
 * Either can be taken away, and taking both away leaves the pane blank. A
 * blank pane says nothing, on purpose: somebody who has removed both knows
 * what this space is for, and a hint in the middle of it would be the thing
 * they were trying to get rid of. Hovering brings back the way to add either.
 *
 * Nothing here is a dialog. Hover the picture for Replace, Edit and Remove,
 * drag the corner to resize, click the line to write it. The model and the
 * storage are in `lib/mail/rest-image`.
 */

import * as React from "react";
import { Image as ImageIcon, Pencil, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  clampCaptionSize,
  clampPan,
  clampWidth,
  clampZoom,
  downscaleTarget,
  filterCss,
  MAIL_REST_ASPECT,
  MAIL_REST_FILTERS,
  MAX_REST_ZOOM,
  readMailRest,
  REST_IMAGE_MAX_EDGE,
  restCaptionText,
  subscribeMailRest,
  writeMailRest,
  type MailRestState,
} from "@/lib/mail/rest-image";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { startPointerDrag } from "@/lib/pointer-drag";

/** A picture narrower than this is a stamp, not a rest. */
const REST_IMAGE_MIN_WIDTH = 320;

function useMailRest(): MailRestState {
  return React.useSyncExternalStore(
    subscribeMailRest,
    readMailRest,
    readMailRest
  );
}

/**
 * Scale a chosen file down and turn it into a data URL.
 *
 * A photo off a phone is several megabytes, and the whole store is about five.
 * Scaling first is what keeps the picture from being the thing that fills it.
 */
async function fileToStoredImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not a picture"));
      element.src = url;
    });
    const target = downscaleTarget(
      image.naturalWidth,
      image.naturalHeight,
      REST_IMAGE_MAX_EDGE
    );
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read that picture");
    context.drawImage(image, 0, 0, target.width, target.height);
    // JPEG: a photo is the case, and PNG of a photo is several times larger.
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A small round control that only appears once the pointer is over its part. */
function HoverRemove({
  label,
  group,
  onClick,
}: {
  label: string;
  /** Which hover group brings it out — `img` or `cap`. */
  group: "img" | "cap";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100",
        group === "img"
          ? "pointer-events-auto bg-stone-900/80 text-white backdrop-blur hover:bg-stone-900 group-hover/img:opacity-100"
          : // On the page rather than on a picture, so it needs its own weight
            // — beside the teal resize dot, a pale grey cross disappeared.
            "border border-stone-300 bg-white text-stone-500 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-800 group-hover/cap:opacity-100"
      )}
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

export function MailRestPanel() {
  const t = useMailT();
  const rest = useMailRest();
  const [editing, setEditing] = React.useState(false);
  const [captionEditing, setCaptionEditing] = React.useState(false);
  const [defaultImage, setDefaultImage] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const captionRef = React.useRef<HTMLSpanElement>(null);

  const frameHeight = Math.round(rest.width / MAIL_REST_ASPECT);
  const hasCaption = rest.caption.trim() !== "" || captionEditing;

  /**
   * Below this width the picture goes and the line stays.
   *
   * A picture needs room to be restful in; a line of type does not. Shrunk
   * into a narrow pane the picture becomes a postage stamp with a sentence
   * under it, which is neither the picture nor the rest it was for — and
   * taking the whole panel away instead left a blank pane, which says
   * nothing at all.
   */
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setPanelWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const tooNarrowForImage =
    panelWidth > 0 && panelWidth < REST_IMAGE_MIN_WIDTH;
  const blank = !rest.hasImage && !hasCaption;

  /**
   * The picture we ship, fetched only while no other one is chosen.
   *
   * A dynamic import so it is a chunk of its own: it is a quarter of a
   * megabyte of base64, and a reader with their own photo — or none — never
   * loads it.
   */
  React.useEffect(() => {
    if (!rest.hasImage || rest.image || defaultImage) return;
    let cancelled = false;
    void import("@/lib/mail/rest-default-image").then((module) => {
      if (!cancelled) setDefaultImage(module.REST_DEFAULT_IMAGE);
    });
    return () => {
      cancelled = true;
    };
  }, [rest.hasImage, rest.image, defaultImage]);

  /** What is on screen: the reader's picture, or the one we ship. */
  const shownImage = rest.hasImage ? (rest.image ?? defaultImage) : null;

  /** One pointer drag, reported as a delta from where it started. */
  const drag = React.useCallback(
    (
      event: React.PointerEvent,
      onMove: (dx: number, dy: number) => void,
      onDone?: () => void
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        {
          onMove: (e) => onMove(e.clientX - startX, e.clientY - startY),
          onEnd: () => onDone?.(),
        }
      );
    },
    []
  );

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    try {
      const image = await fileToStoredImage(file);
      // A new picture starts uncropped, or the old pan would be nonsense.
      writeMailRest({ hasImage: true, image, crop: { x: 0, y: 0, zoom: 1 } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't use that file");
    }
  }

  function removeImage() {
    setEditing(false);
    // The picture goes with the decision. Keeping a few hundred kilobytes of
    // something the reader has taken away is neither tidy nor expected.
    writeMailRest({ hasImage: false, image: null, crop: { x: 0, y: 0, zoom: 1 } });
  }

  function removeCaption() {
    setCaptionEditing(false);
    if (captionRef.current) captionRef.current.textContent = "";
    writeMailRest({ caption: "" });
  }

  function startCaption() {
    setCaptionEditing(true);
    requestAnimationFrame(() => captionRef.current?.focus());
  }

  function commitCaption() {
    const text = (captionRef.current?.textContent ?? "").trim();
    setCaptionEditing(false);
    writeMailRest({ caption: text });
  }

  return (
    <div
      ref={rootRef}
      className="group/rest relative flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPickFile(e.target.files?.[0]);
          // Same file twice in a row should still fire a change.
          e.target.value = "";
        }}
      />

      {/* A figure only when there is a picture to caption. A line on its own
          is not a caption for anything, and it sits in the middle of the pane
          rather than under an empty space. */}
      {rest.hasImage && !tooNarrowForImage ? (
        <figure
          className="m-0 flex flex-col items-center"
          // The size dragged to is the biggest it may be, not the size it
          // is. Set as a width it kept that number whatever the pane did,
          // so on a narrow window the picture ran out over the mail list.
          style={{ width: rest.width, maxWidth: "100%" }}
        >
          <div
            className="group/img relative w-full overflow-hidden rounded-2xl bg-stone-100 shadow-[0_18px_40px_-24px_rgba(28,25,23,0.45)]"
            style={{ height: frameHeight }}
          >
            {shownImage ? (
              <img
                src={shownImage}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover"
                style={{
                  filter: filterCss(rest.filter),
                  transform: `scale(${rest.crop.zoom}) translate(${rest.crop.x * 100}%, ${rest.crop.y * 100}%)`,
                }}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{
                  // While the shipped picture is still on its way.
                  background:
                    "linear-gradient(160deg,#dff0ea 0%,#eef3ea 45%,#f7f1e8 100%)",
                }}
              >
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-white"
                >
                  <ImageIcon className="h-4 w-4" aria-hidden />
                  {t("chooseAPicture")}
                </button>
              </div>
            )}

            {/* Replace, Edit and Remove, top right, on hover. */}
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/img:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                className="pointer-events-auto rounded-lg bg-stone-900/80 px-2.5 py-1 text-xs font-medium text-white backdrop-blur hover:bg-stone-900"
                onClick={() => fileRef.current?.click()}
              >
                {t("replace")}
              </button>
              <button
                type="button"
                aria-pressed={editing}
                className={cn(
                  "pointer-events-auto rounded-lg px-2.5 py-1 text-xs font-medium text-white backdrop-blur",
                  editing ? "bg-teal-600" : "bg-stone-900/80 hover:bg-stone-900"
                )}
                onClick={() => setEditing((v) => !v)}
                disabled={!shownImage}
              >
                {t("edit")}
              </button>
              <HoverRemove
                label={t("removeThePicture")}
                group="img"
                onClick={removeImage}
              />
            </div>

            {/* Resize, bottom right, on hover. */}
            <button
              type="button"
              aria-label={t("resizeThePicture")}
              title={t("dragToResize")}
              onPointerDown={(e) => {
                const startWidth = rest.width;
                drag(e, (dx) =>
                  writeMailRest({ width: clampWidth(startWidth + dx) })
                );
              }}
              className="absolute bottom-1.5 right-1.5 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-teal-500 bg-white/90 opacity-0 transition-opacity group-hover/img:opacity-100"
            />

            {/* Crop, while editing: drag the picture, wheel to zoom. */}
            {editing && shownImage ? (
              <div
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  const start = rest.crop;
                  const box = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  drag(e, (dx, dy) => {
                    const next = clampPan(
                      start.x + dx / box.width / start.zoom,
                      start.y + dy / box.height / start.zoom,
                      start.zoom
                    );
                    writeMailRest({ crop: { ...next, zoom: start.zoom } });
                  });
                }}
                onWheel={(e) => {
                  const zoom = clampZoom(rest.crop.zoom - e.deltaY * 0.002);
                  const pan = clampPan(rest.crop.x, rest.crop.y, zoom);
                  writeMailRest({ crop: { ...pan, zoom } });
                }}
              />
            ) : null}
          </div>

          {/* The look, and the zoom, while editing. */}
          {editing && shownImage ? (
            <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-1.5">
              {MAIL_REST_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => writeMailRest({ filter: option.id })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    rest.filter === option.id
                      ? "border-teal-600 bg-teal-50 text-teal-800"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                  )}
                >
                  {option.label}
                </button>
              ))}
              <input
                type="range"
                min={1}
                max={MAX_REST_ZOOM}
                step={0.01}
                value={rest.crop.zoom}
                aria-label={t("zoom")}
                className="ml-1 w-28 accent-teal-700"
                onChange={(e) => {
                  const zoom = clampZoom(Number(e.target.value));
                  const pan = clampPan(rest.crop.x, rest.crop.y, zoom);
                  writeMailRest({ crop: { ...pan, zoom } });
                }}
              />
              <button
                type="button"
                className="rounded-full bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700"
                onClick={() => setEditing(false)}
              >
                {t("done")}
              </button>
            </div>
          ) : null}
        </figure>
      ) : null}

      {/* The line. Under the picture when there is one, in the middle of the
          pane when there is not. Remove on the left and resize on the right
          are the same width, so the words stay centred whether or not the
          pointer is over them. */}
      {hasCaption ? (
        <div className="group/cap flex max-w-[42rem] items-end justify-center gap-2">
          <HoverRemove
            label={t("removeTheLine")}
            group="cap"
            onClick={removeCaption}
          />
          <span
            ref={captionRef}
            role="textbox"
            tabIndex={0}
            aria-label={t("caption")}
            contentEditable={captionEditing}
            suppressContentEditableWarning
            title={captionEditing ? undefined : t("clickToEdit")}
            onClick={() => setCaptionEditing(true)}
            onFocus={() => setCaptionEditing(true)}
            onBlur={commitCaption}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLElement).blur();
              }
              if (e.key === "Escape") {
                if (captionRef.current) {
                  captionRef.current.textContent = restCaptionText(
                    rest.caption
                  );
                }
                (e.currentTarget as HTMLElement).blur();
              }
            }}
            className={cn(
              "max-w-full cursor-text whitespace-pre-wrap break-words border-b border-dashed text-center font-serif italic leading-tight text-stone-800 outline-none",
              captionEditing
                ? "border-teal-500"
                : "border-transparent group-hover/cap:border-stone-300"
            )}
            style={{ fontSize: rest.captionSize }}
          >
            {restCaptionText(rest.caption)}
          </span>
          <button
            type="button"
            aria-label={t("resizeTheLine")}
            title={t("dragToResize")}
            onPointerDown={(e) => {
              const startSize = rest.captionSize;
              // Sideways only, and slowly: the handle sits beside the words,
              // so right means bigger, and the whole range is 14pt to 64pt.
              drag(e, (dx) =>
                writeMailRest({
                  captionSize: clampCaptionSize(startSize + dx / 6),
                })
              );
            }}
            className="mb-1 inline-flex h-5 w-5 shrink-0 items-center justify-center"
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 border-teal-500 bg-white opacity-0 transition-opacity group-hover/cap:opacity-100" />
          </button>
        </div>
      ) : null}

      {/* The way back. Out of the flow, so what is left keeps the middle of
          the pane to itself — a line on its own is centred on the page, not
          pushed up by a row of controls under it. */}
      {rest.hasImage && hasCaption ? null : (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-4 opacity-0 transition-opacity duration-200 group-hover/rest:opacity-100",
            // Nothing to sit under, so it takes the middle itself.
            blank ? "top-1/2 -translate-y-1/2" : "bottom-8"
          )}
        >
          {rest.hasImage ? null : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pointer-events-auto flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              {t("addAPicture")}
            </button>
          )}
          {hasCaption ? null : (
            <button
              type="button"
              onClick={startCaption}
              className="pointer-events-auto flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t("addALine")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
