"use client";

/*
 * A long thread's outline.
 *
 * At rest, a narrow rail at the reader's top right: one tick a message, in
 * the thread's order. Theirs grey at the left, yours blue and set in, as
 * your bubbles stand at the right; unread ones in the accent; the ones on
 * screen in ink and a pixel thicker. A gap between days.
 *
 * Under the pointer it opens into a list of every message: who, the first
 * line, a clip when there are files, the time. The row for the tick under
 * the pointer is in the middle and marked; the rows on screen are shaded.
 * A click on a row brings that message to the top of the reader.
 *
 * Only for a thread that does not fit, and only while the person has it on
 * (the button in the thread's strip; thread-outline-setting).
 *
 * A long thread is loaded fifty messages at a time, but the outline shows
 * all of it. Its whole list comes from one light request
 * (/api/mail/thread-outline: headers and first words, no bodies), fetched
 * only when the thread has more than is loaded, and kept for the thread
 * until a new message arrives. Where a message is loaded, the loaded copy
 * wins. One not loaded yet is a fainter tick, and a click on its row loads
 * the window around it.
 */

import * as React from "react";
import { List, Paperclip } from "lucide-react";

import { timeOfDay } from "@/lib/mail/date-format";
import { useMailT } from "@/lib/mail/i18n";
import { useThreadOutline, writeThreadOutline } from "@/lib/mail/thread-outline-setting";
import { mailApiJson } from "@/lib/mail/api";
import type { MailOutlineItem } from "@/lib/mail/types";
import type { OutlineEntry } from "@/lib/mail/outline-merge";

export { mergeOutline, type OutlineEntry } from "@/lib/mail/outline-merge";
import { cn } from "@/lib/utils";

/** From one tick to the next, and the extra gap where a day begins. */
const PITCH = 6;
const DAY_GAP = 8;
/** Where the rail stands in the reader: 14px down and 14px in from the
 *  right. The strip's buttons and the people above end at the same 14px,
 *  over the rail's blue ticks. */
const RAIL_INSET = 14;
/** The reader's right padding while the rail is there: bubbles stay clear of it. */
export const OUTLINE_READER_ROOM = "pr-16";

function dayOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase();
}

/** Outlines already read, by account, thread and newest message. */
const outlines = new Map<string, MailOutlineItem[]>();

/**
 * The thread's full outline, when it has more than is loaded. Null while it
 * is on its way, when it is not needed, or when it could not be read: the
 * outline then shows what is loaded, as before.
 */
export function useOutlineItems(
  account: string,
  threadId: string,
  newestId: string | undefined,
  needed: boolean
): MailOutlineItem[] | null {
  const key = `${account}|${threadId}|${newestId ?? ""}`;
  const [items, setItems] = React.useState<{ key: string; items: MailOutlineItem[] } | null>(null);
  React.useEffect(() => {
    if (!needed || !account || !threadId) return;
    const kept = outlines.get(key);
    if (kept) {
      setItems({ key, items: kept });
      return;
    }
    let live = true;
    const params = new URLSearchParams({ account, id: threadId });
    mailApiJson<{ items: MailOutlineItem[] }>(`/api/mail/thread-outline?${params.toString()}`)
      .then((json) => {
        outlines.set(key, json.items);
        if (live) setItems({ key, items: json.items });
      })
      .catch(() => {
        /* the loaded messages stand in */
      });
    return () => {
      live = false;
    };
  }, [account, threadId, key, needed]);
  return needed && items?.key === key ? items.items : null;
}

function messageSelector(id: string): string {
  return `[data-message-id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

/** The ids of the messages any part of which is on screen in the reader. */
function useInView(node: HTMLElement | null, active: boolean, count: number): Set<string> {
  const [ids, setIds] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    if (!node || !active) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      const next = new Set<string>();
      node.querySelectorAll<HTMLElement>("[data-message-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > box.top && r.top < box.bottom && el.dataset.messageId) {
          next.add(el.dataset.messageId);
        }
      });
      setIds((prev) =>
        prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next
      );
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    node.addEventListener("scroll", later, { passive: true });
    const watch = new ResizeObserver(later);
    watch.observe(node);
    if (node.firstElementChild) watch.observe(node.firstElementChild);
    return () => {
      node.removeEventListener("scroll", later);
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [node, active, count]);
  return ids;
}

/** The button in the thread's strip. Not there when the thread fits. */
export function ThreadOutlineToggle({ overflows }: { overflows: boolean }) {
  const t = useMailT();
  const on = useThreadOutline();
  if (!overflows) return null;
  const label = on ? t("threadOutlineHide") : t("threadOutlineShow");
  return (
    <button
      type="button"
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={() => writeThreadOutline(!on)}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
        on
          ? "bg-[var(--mail-chrome-selected)] text-[var(--mail-chrome-fg)]"
          : "bg-transparent text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)]"
      )}
    >
      <List className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Whether a thread is one to outline: it does not fit, and it has more than
 * one message. One long message has nothing to move between.
 */
export function outlineWanted(overflows: boolean, messageCount: number): boolean {
  return overflows && messageCount > 1;
}

/** Whether the rail is shown: the thread is one to outline, and the person has it on. */
export function useThreadOutlineShown(overflows: boolean): boolean {
  const on = useThreadOutline();
  return on && overflows;
}

type Tick = { message: OutlineEntry; top: number; newDay: boolean };

function layTicks(messages: OutlineEntry[]): { ticks: Tick[]; height: number } {
  let y = 0;
  let lastDay = "";
  const ticks = messages.map((message, i) => {
    const day = dayOf(message.sentAt);
    const newDay = i > 0 && day !== lastDay;
    if (i > 0) y += PITCH + (newDay ? DAY_GAP : 0);
    lastDay = day;
    return { message, top: y, newDay: i === 0 || newDay };
  });
  return { ticks, height: y + 3 };
}

/**
 * The rail and its outline, laid over the reader. `node` is the reader's
 * scrolling box; this sits beside it, in the box that holds it.
 */
export function ThreadOutline({
  node,
  messages,
  shown,
  onLoad,
}: {
  node: HTMLDivElement | null;
  messages: OutlineEntry[];
  shown: boolean;
  /** Load the window around a message the reader does not have yet. */
  onLoad: (id: string) => void;
}) {
  const t = useMailT();
  const inView = useInView(node, shown, messages.length);
  const [openAt, setOpenAt] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const railRef = React.useRef<HTMLDivElement | null>(null);
  const { ticks, height } = React.useMemo(() => layTicks(messages), [messages]);

  // A rail taller than the reader is pressed together to fit it.
  const room = Math.max(40, (node?.clientHeight ?? 400) - 2 * RAIL_INSET);
  const scale = height > room ? room / height : 1;

  // Turned off, or the thread now fits: the outline goes with the rail.
  React.useEffect(() => {
    if (!shown) setOpenAt(null);
  }, [shown]);

  // On opening: the hovered message's row in the middle of the list.
  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !openAt) return;
    const row = panel.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(openAt)}"]`);
    if (row) panel.scrollTop = row.offsetTop - panel.clientHeight / 2 + row.offsetHeight / 2;
    // Only as it opens: moving within the list must not move the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt === null]);

  if (!shown || messages.length === 0) return null;

  const tickAt = (clientY: number): string | null => {
    const rail = railRef.current;
    if (!rail) return null;
    const y = (clientY - rail.getBoundingClientRect().top) / scale;
    let best: Tick | null = null;
    for (const tick of ticks) {
      if (!best || Math.abs(tick.top - y) < Math.abs(best.top - y)) best = tick;
    }
    return best?.message.id ?? null;
  };

  const jump = (id: string) => {
    const target = node?.querySelector<HTMLElement>(messageSelector(id));
    if (!target) {
      onLoad(id);
      return;
    }
    if (!node) return;
    const offset = target.getBoundingClientRect().top - node.getBoundingClientRect().top;
    node.scrollTo({ top: Math.max(0, node.scrollTop + offset - 16), behavior: "smooth" });
  };

  return (
    <>
      <div
        ref={railRef}
        aria-hidden
        className="absolute z-10 w-[22px] cursor-pointer"
        style={{ top: RAIL_INSET, right: RAIL_INSET, height: height * scale }}
        onMouseEnter={(e) => setOpenAt(tickAt(e.clientY))}
      >
        {ticks.map(({ message, top }) => {
          const seen = inView.has(message.id);
          return (
            <span
              key={message.id}
              className="absolute w-[14px] rounded-[2px]"
              style={{
                // Not loaded yet: there, but fainter.
                opacity: message.loaded ? 1 : 0.45,
                top: top * scale,
                left: message.own ? 8 : 0,
                height: seen ? 3 : 2,
                background: message.unread
                  ? "var(--mail-accent)"
                  : seen
                    ? "var(--mail-chrome-fg)"
                    : message.own
                      ? "var(--mail-tick-own)"
                      : "var(--mail-tick-other)",
              }}
            />
          );
        })}
      </div>
      {openAt ? (
        <div
          ref={panelRef}
          role="list"
          className="mail-chrome-strip absolute bottom-2 right-2 top-2 z-40 w-[280px] overflow-y-auto rounded-[12px] border border-[var(--mail-chrome-border)] bg-[var(--mail-pane)] py-1.5 shadow-[0_8px_24px_rgba(30,45,62,0.16)]"
          onMouseLeave={() => setOpenAt(null)}
        >
          {ticks.map(({ message, newDay }) => {
            const line = message.firstLine;
            return (
              <React.Fragment key={message.id}>
                {newDay ? (
                  <p className="px-3.5 pb-1 pt-2.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--mail-chrome-muted)]">
                    {dayLabel(message.sentAt)}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="listitem"
                  data-outline-id={message.id}
                  onClick={() => jump(message.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3.5 py-[5px] text-left text-[12px]",
                    message.id === openAt
                      ? "bg-[var(--mail-chrome-selected)]"
                      : inView.has(message.id)
                        ? "bg-[var(--mail-chrome-hover)]"
                        : "hover:bg-[var(--mail-chrome-hover)]"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      message.unread ? "bg-[var(--mail-accent)]" : "bg-transparent"
                    )}
                  />
                  <span
                    className={cn(
                      "max-w-[40%] shrink-0 truncate",
                      message.unread && "font-semibold",
                      message.own ? "text-[var(--mail-own-ink)]" : "text-[var(--mail-chrome-fg)]"
                    )}
                  >
                    {message.own ? t("threadYou") : message.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--mail-chrome-muted)]">{line}</span>
                  {message.hasAttachments ? (
                    <Paperclip className="h-3 w-3 shrink-0 text-[var(--mail-chrome-muted)]" aria-hidden />
                  ) : null}
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--mail-chrome-muted)]">
                    {timeOfDay(message.sentAt)}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
