/**
 * The picture in the empty reading pane.
 *
 * The arithmetic is what matters here: a pan that lets an edge slide into
 * view, or a picture stored at full phone resolution, both look like bugs
 * somewhere else — a crooked frame, or a storage quota that fills up and
 * silently drops the reader's other settings.
 */

import {
  clampCaptionSize,
  clampPan,
  clampWidth,
  clampZoom,
  DEFAULT_MAIL_REST,
  downscaleTarget,
  filterCss,
  MAX_CAPTION_SIZE,
  MAX_REST_WIDTH,
  MIN_CAPTION_SIZE,
  MIN_REST_WIDTH,
  normalizeRestState,
  REST_IMAGE_MAX_EDGE,
} from "@/lib/mail/rest-image";

import { check, suite } from "./harness.mjs";

suite(async () => {
  // --- Sizes stay inside their limits -------------------------------------

  check("a width below the floor is lifted", clampWidth(10) === MIN_REST_WIDTH);
  check("a width above the ceiling is capped", clampWidth(99999) === MAX_REST_WIDTH);
  check("a sensible width is kept", clampWidth(480) === 480);
  check(
    "nonsense falls back to the default",
    clampWidth(Number.NaN) === DEFAULT_MAIL_REST.width
  );
  check(
    "caption size has its own limits",
    clampCaptionSize(2) === MIN_CAPTION_SIZE &&
      clampCaptionSize(500) === MAX_CAPTION_SIZE
  );

  // --- Pan cannot pull an edge into the frame -----------------------------

  check(
    "at zoom 1 there is nothing to pan",
    clampPan(0.4, -0.4, 1).x === 0 && clampPan(0.4, -0.4, 1).y === 0,
    JSON.stringify(clampPan(0.4, -0.4, 1))
  );
  check(
    "at zoom 2 half the extra is free in each direction",
    clampPan(5, -5, 2).x === 0.5 && clampPan(5, -5, 2).y === -0.5,
    JSON.stringify(clampPan(5, -5, 2))
  );
  check(
    "a pan inside the room is left alone",
    clampPan(0.1, 0.1, 2).x === 0.1
  );
  check("zoom cannot go below filling the frame", clampZoom(0.2) === 1);

  // --- What gets stored ---------------------------------------------------

  const big = downscaleTarget(4032, 3024, REST_IMAGE_MAX_EDGE);
  check(
    "a phone photo is scaled to the long edge",
    big.width === REST_IMAGE_MAX_EDGE,
    `${big.width}x${big.height}`
  );
  check(
    "and keeps its proportions",
    Math.abs(big.width / big.height - 4032 / 3024) < 0.01,
    `${(big.width / big.height).toFixed(3)} vs ${(4032 / 3024).toFixed(3)}`
  );
  check(
    "a portrait photo is measured on its long edge too",
    downscaleTarget(3024, 4032).height === REST_IMAGE_MAX_EDGE
  );
  check(
    "a small picture is left at its own size",
    downscaleTarget(800, 600).width === 800
  );

  // --- Reading a stored value --------------------------------------------

  check(
    "nothing stored gives the default",
    normalizeRestState(null).caption === DEFAULT_MAIL_REST.caption
  );
  check(
    "junk gives the default rather than throwing",
    normalizeRestState("not an object").width === DEFAULT_MAIL_REST.width
  );
  check(
    "a data URL is kept",
    normalizeRestState({ image: "data:image/jpeg;base64,AAA" }).image ===
      "data:image/jpeg;base64,AAA"
  );
  // A remote address would be fetched on every open, telling whoever serves
  // it when this reader opened their mail.
  check(
    "a remote address is refused",
    normalizeRestState({ image: "https://tracker.example/pixel.png" }).image === null
  );
  check(
    "a javascript: URL is refused",
    normalizeRestState({ image: "javascript:alert(1)" }).image === null
  );
  check(
    "an unknown filter falls back to the original",
    normalizeRestState({ filter: "wat" }).filter === "none"
  );
  check(
    "a stored pan is re-checked against its zoom",
    normalizeRestState({ crop: { x: 9, y: 0, zoom: 2 } }).crop.x === 0.5,
    String(normalizeRestState({ crop: { x: 9, y: 0, zoom: 2 } }).crop.x)
  );
  check(
    "a very long caption is cut rather than stored whole",
    normalizeRestState({ caption: "x".repeat(5000) }).caption.length === 200
  );

  check("the original look asks for no filter", filterCss("none") === "none");
  check("grey is grayscale", filterCss("grayscale") === "grayscale(1)");

  // --- A pane with nothing in it ------------------------------------------
  //
  // `image: null` means two different things — nobody has chosen one, so show
  // the one we ship — and, once somebody has taken the picture away, show
  // nothing. `hasImage` is what tells those apart, and a value stored before
  // it existed must read as "has one".

  check("a picture is the starting point", DEFAULT_MAIL_REST.hasImage === true);
  check(
    "a stored value from before this field reads as having one",
    normalizeRestState({ width: 400 }).hasImage === true
  );
  check(
    "only a stored false takes the picture away",
    normalizeRestState({ hasImage: false }).hasImage === false
  );
  check(
    "nonsense in that field still means a picture",
    normalizeRestState({ hasImage: "no" }).hasImage === true &&
      normalizeRestState({ hasImage: 0 }).hasImage === true
  );
  check(
    "taking the picture away survives a round trip",
    normalizeRestState(
      JSON.parse(JSON.stringify(normalizeRestState({ hasImage: false })))
    ).hasImage === false
  );
  check(
    "an empty line is a line taken away, not a missing one",
    normalizeRestState({ caption: "" }).caption === "" &&
      normalizeRestState({}).caption === DEFAULT_MAIL_REST.caption
  );
});
