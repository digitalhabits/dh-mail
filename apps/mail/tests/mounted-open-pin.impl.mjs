/**
 * The walk itself — see mounted-open-pin.test.mjs.
 *
 * happy-dom lays nothing out, so the scroller and the newest message are
 * stood in for. The stand-in rounds as WebKit did at a zoom: each placing
 * lands on the next of 300, 302 and 301 px, as the recording showed.
 * Every fixture is invented.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useStreamOpenPosition } from "@/components/mail/use-thread-stream";

import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THREAD = {
  account: "ada@example.test",
  threadId: "pin-thread",
  messages: [{ id: "older" }, { id: "newest" }],
};

function Stream() {
  const scrollRef = React.useRef(null);
  useStreamOpenPosition({
    focusMessageId: null,
    highlightMessageId: null,
    scrollRef,
    setHighlightMessageId: () => {},
    skipOpenPinRef: { current: false },
    thread: THREAD,
    threadId: THREAD.threadId,
    zoomRef: { current: 1.1 },
  });
  return React.createElement(
    "div",
    { ref: scrollRef, id: "scroller" },
    ...THREAD.messages.map((m) =>
      React.createElement("div", {
        key: m.id,
        "data-mail-bubble": "1",
        "data-message-id": m.id,
      })
    )
  );
}

/** Stands in for the browser's layout under the scroller and the newest message. */
function layOut(scroller, newest) {
  const state = { top: 0, grown: 0, placings: 0, moves: [] };
  const rounding = [300, 302, 301];
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => state.top,
    set: (value) => {
      if (value !== state.top) state.moves.push(value);
      state.top = value;
    },
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 800 });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 4000 });
  newest.getBoundingClientRect = () => ({ top: 600 + state.grown - state.top });
  newest.scrollIntoView = () => {
    const at = rounding[state.placings % rounding.length] + state.grown;
    state.placings += 1;
    scroller.scrollTop = at;
  };
  return state;
}

suite(async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(React.createElement(Stream));
  let scroller = null;
  for (let i = 0; i < 100 && !scroller; i += 1) {
    await sleep(10);
    scroller = host.querySelector("#scroller");
  }
  const newest = scroller.querySelector('[data-message-id="newest"]');
  // The first placing ran at mount, against happy-dom's own numbers. The
  // stand-in starts from there.
  const state = layOut(scroller, newest);
  await sleep(200);

  const settledAt = state.top;
  const movesBefore = state.moves.length;
  await sleep(1000);
  check(
    "a message still where it was put is left alone on every heartbeat",
    state.moves.length === movesBefore && state.top === settledAt,
    `scroll ${settledAt} → ${state.top}, moves in a second: ${state.moves.slice(movesBefore).join(", ") || "none"}`
  );

  state.grown = 180;
  await sleep(400);
  check(
    "a message pushed down by something above is followed",
    state.top >= 480 && state.top <= 482,
    `scroll now ${state.top}`
  );

  const followedAt = state.top;
  const movesAfterFollow = state.moves.length;
  await sleep(800);
  check(
    "and is left alone once it is back in its place",
    state.moves.length === movesAfterFollow && state.top === followedAt,
    `moves since: ${state.moves.slice(movesAfterFollow).join(", ") || "none"}`
  );

  root.unmount();
});
