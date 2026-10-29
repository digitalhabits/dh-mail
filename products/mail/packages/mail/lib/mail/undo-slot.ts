/*
 * The confirmation of an archive, delete, move, snooze or send, with its
 * Undo, in one place.
 *
 * They were toasts at the foot of the window, which sat over the thread or
 * the reply being written. Then (2026-10-27) the row that left became the
 * confirmation, in its place in the list, but a list scrolled away from that
 * place hid it, and a send still had a toast of its own. Now (2026-10-28)
 * all of them stand at the foot of the list, or at the foot of the reader
 * when the list is put away. Only when neither is on screen does it fall
 * back to a toast.
 *
 * They stack, newest in front, as the toasts did: the older ones peek out
 * behind it, and the pointer on the stack spreads it out. Each goes after
 * UNDO_SLOT_MS of its own (a send when it is sent), and every time stops
 * while the pointer is on the stack. Command+Z takes back the newest, then
 * the next (mail-undo-stack), and each leaves the stack as it is taken back.
 *
 * Pure: no React. The places that draw it are in undo-slot-row.tsx; the
 * actions that fill it are in use-mail-undo.ts and undo-send.tsx.
 */

export const UNDO_SLOT_MS = 8000;

export type UndoSlotAction = "archive" | "trash" | "move" | "snooze" | "send" | "discard";

export type UndoSlot = {
  id: string;
  /** Which action, for its icon. */
  action: UndoSlotAction;
  /** What happened, first and in bold: "Archived", "Snoozed until 18:13". */
  verb: string;
  /**
   * A send that waits: the verb is said again each second from the seconds
   * left until `endsAt` ("Sending in 4…"), and the slot goes when it is sent.
   */
  countdown?: { endsAt: number; verb: (left: number) => string };
  /** How long it stays, when not UNDO_SLOT_MS. */
  ms?: number;
  /** Told when it leaves the stack, by Undo or by its time. */
  onGone?: () => void;
  /** What it happened to: a subject, "GitHub stack (5)", "7 conversations". */
  object: string;
  /** The whole sentence, for the toast it falls back to. */
  label: string;
  undo: () => void;
};

export type UndoSlotState = {
  /** What is shown, newest first. The first is the top of the stack. */
  slots: UndoSlot[];
  /** The top of the stack, or null. */
  slot: UndoSlot | null;
  /** A list is on screen to show it in (counted: each mounted list). */
  listOn: number;
  /** A reader toolbar is on screen to show it in. */
  stripOn: number;
};

/** How many stand in the stack. Older ones still wait on Command+Z. */
export const UNDO_SLOT_MAX = 5;

type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * Shown when no list and no toolbar is there to show it. Returns how to
 * take the toast away again.
 */
export type UndoSlotFallback = (slot: UndoSlot) => () => void;

type Clock = { timer: unknown; left: number; startedAt: number };

export function createUndoSlotStore(timers: Timers = realTimers) {
  let state: UndoSlotState = { slots: [], slot: null, listOn: 0, stripOn: 0 };
  const listeners = new Set<() => void>();
  // Each one has its own time, as each toast had.
  const clocks = new Map<string, Clock>();
  let held = false;
  let fallback: UndoSlotFallback | null = null;
  let fallbackCheck: unknown = null;
  const dropFallbacks = new Map<string, () => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const set = (next: Partial<UndoSlotState>) => {
    state = { ...state, ...next };
    if (next.slots) state.slot = next.slots[0] ?? null;
    emit();
  };
  const run = (id: string) => {
    const clock = clocks.get(id);
    if (!clock) return;
    clock.startedAt = timers.now();
    clock.timer = timers.set(() => clear(id), clock.left);
  };
  const pause = (id: string) => {
    const clock = clocks.get(id);
    if (!clock || clock.timer == null) return;
    timers.clear(clock.timer);
    clock.timer = null;
    clock.left = Math.max(1000, clock.left - (timers.now() - clock.startedAt));
  };
  const stop = (id: string) => {
    const clock = clocks.get(id);
    if (clock?.timer != null) timers.clear(clock.timer);
    clocks.delete(id);
  };
  const dropFallback = (id: string) => {
    dropFallbacks.get(id)?.();
    dropFallbacks.delete(id);
  };
  const dropAllFallbacks = () => {
    for (const id of [...dropFallbacks.keys()]) dropFallback(id);
  };
  /** Nowhere on screen to draw them: a toast for each, as before. */
  const checkFallback = () => {
    fallbackCheck = null;
    if (!fallback || state.listOn > 0 || state.stripOn > 0) return;
    for (const slot of state.slots) {
      if (!dropFallbacks.has(slot.id)) dropFallbacks.set(slot.id, fallback(slot));
    }
  };

  /** Take one away (its Undo, its time); with no id, all of them. */
  function clear(id?: string) {
    const going = id ? state.slots.filter((s) => s.id === id) : state.slots;
    if (!going.length) return;
    for (const s of going) {
      stop(s.id);
      dropFallback(s.id);
    }
    // Told after the stack has changed, so a caller can act on it.
    const told = going.filter((s) => s.onGone);
    if (!state.slots.length || (id && state.slots.length === 1)) held = false;
    set({ slots: id ? state.slots.filter((s) => s.id !== id) : [] });
    for (const s of told) s.onGone?.();
  }

  return {
    get: (): UndoSlotState => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** On top of the stack. The oldest past the limit leaves the stack. */
    show(slot: UndoSlot) {
      const slots = [slot, ...state.slots.filter((s) => s.id !== slot.id)];
      for (const old of slots.slice(UNDO_SLOT_MAX)) {
        stop(old.id);
        dropFallback(old.id);
        old.onGone?.();
      }
      clocks.set(slot.id, { timer: null, left: slot.ms ?? UNDO_SLOT_MS, startedAt: 0 });
      if (!held) run(slot.id);
      set({ slots: slots.slice(0, UNDO_SLOT_MAX) });
      // After the list and the toolbar have drawn: a place that mounts on
      // the same change counts.
      if (fallbackCheck != null) timers.clear(fallbackCheck);
      fallbackCheck = timers.set(checkFallback, 50);
    },
    clear,
    /** The pointer is on the stack: every time stops, and goes on after. */
    hold(on: boolean) {
      if (on === held) return;
      held = on;
      for (const s of state.slots) (on ? pause : run)(s.id);
    },
    /** A place to draw them is on screen. Returns its leaving. */
    mount(place: "list" | "strip") {
      const key = place === "list" ? "listOn" : "stripOn";
      set({ [key]: state[key] + 1 });
      dropAllFallbacks();
      return () => {
        set({ [key]: Math.max(0, state[key] - 1) });
      };
    },
    setFallback(next: UndoSlotFallback | null) {
      fallback = next;
    },
  };
}

export type UndoSlotStore = ReturnType<typeof createUndoSlotStore>;

/** A person's stack, as the people view shows it, for naming what was acted on. */
export type UndoStack = { name: string; keys: readonly string[] };

export type UndoTargetWords = {
  conversations: (count: number) => string;
  stack: (name: string, count: number) => string;
  and: string;
};

/**
 * What many conversations were, in the words of the list they were picked
 * from: "3 conversations and Google Ads stack (3)". A whole stack is named
 * as one; conversations on their own are counted. More than two stacks is
 * too long to read in a row, so it is the count of conversations.
 *
 * `stacks` is null in the conversation view, where there are none.
 */
export function describeUndoTargets(
  keys: readonly string[],
  stacks: readonly UndoStack[] | null,
  words: UndoTargetWords
): string {
  const total = keys.length;
  if (!stacks) return words.conversations(total);
  const picked = new Set(keys);
  let loose = 0;
  const named: string[] = [];
  const seen = new Set<string>();
  for (const stack of stacks) {
    const inIt = stack.keys.filter((key) => picked.has(key));
    if (!inIt.length) continue;
    for (const key of inIt) seen.add(key);
    if (inIt.length > 1 && inIt.length === stack.keys.length) named.push(words.stack(stack.name, inIt.length));
    else loose += inIt.length;
  }
  loose += total - seen.size;
  if (named.length > 2 || !named.length) return words.conversations(total);
  const parts = [...(loose ? [words.conversations(loose)] : []), ...named];
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} ${words.and} ${parts.at(-1)}`;
}

/** The page's one store. A reader window has its own page, and its own. */
export const mailUndoSlot = createUndoSlotStore();
