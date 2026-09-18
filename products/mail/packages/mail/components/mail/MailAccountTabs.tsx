"use client";

/**
 * Which mailbox the list is showing: All, or one of them.
 *
 * This is the row that used to hold All / In Contacts / Other. Those are
 * filters — they narrow whatever is on screen — and they moved behind the
 * button at the end of this row. What a reader reaches for first is whose
 * mail they are looking at, so that is what the row now holds.
 *
 * The tabs are in the order the mailboxes are kept in, which the folder rail
 * sets by dragging. One row, one order, everywhere.
 */

import * as React from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Moon } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { AccountMark } from "@/components/mail/AccountMark";
import { AutoReplyBadge } from "@/components/mail/AutoReplyMark";
import {
  MarkMenu,
  fileToMark,
} from "@/components/mail/AccountMarkButton";
import { setAccountMark, useAccountMarks } from "@/lib/mail/account-mark";
import type { AccountChipLabel } from "@/lib/mail/account-labels";
import { ALL_TAB_ID, writeAccountOrder } from "@/lib/mail/account-order";
import { useAccountOrder } from "@/lib/mail/use-account-order";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";


/**
 * One mailbox tab, which can be dragged along the row.
 *
 * The order is the reader's arrangement — the same one the folder rail sets
 * by dragging its headings, and the same one the chips and the mail list
 * follow. Dragged here or dragged there, it is one order.
 *
 * A drag of four pixels is what starts one, so a press stays a press: these
 * tabs choose a mailbox and open its picture, and neither must go off in the
 * hand of somebody who moved the mouse while clicking.
 */
function SortableAccountTab({
  email,
  children,
  className,
  title,
  pressed,
  suppressClick,
  onSelect,
  onContextMenu,
}: {
  email: string;
  children: React.ReactNode;
  className: string;
  title: string;
  pressed: boolean;
  suppressClick: React.MutableRefObject<boolean>;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: email });
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={title}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      // After the drag attributes, which carry one of their own.
      aria-pressed={pressed}
      className={cn(
        className,
        "touch-none",
        isDragging && "z-10 cursor-grabbing opacity-80"
      )}
      onClick={(event) => {
        if (suppressClick.current || isDragging) return;
        onSelect(event);
      }}
      onContextMenu={onContextMenu}
    >
      {children}
    </button>
  );
}

export function MailAccountTabs({
  accounts,
  labels,
  isOutlookAccount,
  /** Empty means every mailbox. One address means that one. */
  selected,
  onSelect,
  onReorder,
  onNavy = false,
  /**
   * A pick in a menu: the same tabs, without a drag and without the
   * picture menu. The pause menu uses this so the row is the row, not a
   * second place to rearrange mailboxes.
   */
  selectOnly = false,
  /**
   * Mailboxes that are not fetching. The key is the address in lower case,
   * the value is the hover — when that mailbox wakes.
   */
  quietUntil,
  autoReplyOn,
}: {
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  isOutlookAccount: (email: string) => boolean;
  selected: string[];
  onSelect: (emails: string[]) => void;
  /** The whole row, in its new order, after one has been dragged along it. */
  onReorder?: (accounts: string[]) => void;
  onNavy?: boolean;
  selectOnly?: boolean;
  quietUntil?: Map<string, string>;
  /**
   * Mailboxes answering on their own. The key is the address in lower case,
   * the value is the hover — which mailbox, and until when.
   */
  autoReplyOn?: Map<string, string>;
}) {
  const t = useMailT();
  const marks = useAccountMarks();
  const order = useAccountOrder();
  const [menu, setMenu] = React.useState<{
    account: string;
    x: number;
    y: number;
  } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const forRef = React.useRef<string | null>(null);
  /** A drop synthesises a click. That one is not a press. */
  const suppressClick = React.useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  /**
   * The row, in order, with All among the mailboxes rather than nailed to the
   * front of them: it is a tab like the others and moves like one.
   *
   * Anything the arrangement names that is not on the row is passed over — a
   * mailbox since disconnected — and anything on the row it does not name is
   * added at the end, which is where a mailbox connected since the last drag
   * belongs.
   */
  const rowIds = React.useMemo(() => {
    const byKey = new Map(accounts.map((email) => [email.toLowerCase(), email]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of order) {
      const key = entry.toLowerCase();
      if (seen.has(key)) continue;
      if (key === ALL_TAB_ID) {
        seen.add(key);
        out.push(ALL_TAB_ID);
        continue;
      }
      const email = byKey.get(key);
      if (!email) continue;
      seen.add(key);
      out.push(email);
    }
    if (!seen.has(ALL_TAB_ID)) out.unshift(ALL_TAB_ID);
    for (const email of accounts) {
      if (!seen.has(email.toLowerCase())) out.push(email);
    }
    return out;
  }, [accounts, order]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (!over || active.id === over.id) return;
    const from = rowIds.indexOf(String(active.id));
    const to = rowIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(rowIds, from, to);
    // The whole row is written, All and all; the mailboxes alone go back to
    // the host, so its own list answers at once.
    writeAccountOrder(next);
    onReorder?.(next.filter((id) => id !== ALL_TAB_ID));
  };

  const allMailboxes = selected.length === 0;

  const pick = async (file: File | undefined) => {
    const account = forRef.current;
    forRef.current = null;
    if (!file || !account) return;
    try {
      setAccountMark(account, await fileToMark(file));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotReadThatPicture")
      );
    }
  };

  /*
    A row of choices with one switched on.

    Named colours rather than `bg-white`: on the dark theme white is what
    the blanket rewrite turns into chrome, so the chosen tab was the same
    shade as the track it sits on. The three tokens say track, chosen, and
    the rest — see --mail-segment in mail.css, which turns them over per
    theme.
  */
  const tab = (active: boolean) =>
    cn(
      // `relative`: the out-of-office badge sits on the tab's own corner.
      "relative flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors",
      active
        ? "bg-[var(--mail-segment-active)] font-semibold text-[var(--mail-segment-active-fg)] shadow-sm"
        : "text-[var(--mail-segment-fg)] hover:text-[var(--mail-segment-active-fg)]"
    );

  const renderTab = (id: string, sortable: boolean) => {
    if (id === ALL_TAB_ID) {
      const inner = (
        <>
          <AccountMark provider="unknown" className="h-3.5 w-3.5" />
          {t("tabAll")}
        </>
      );
      if (!sortable) {
        return (
          <button
            key={ALL_TAB_ID}
            type="button"
            title={t("allMailboxes")}
            aria-pressed={allMailboxes}
            className={tab(allMailboxes)}
            onClick={() => onSelect([])}
          >
            {inner}
          </button>
        );
      }
      return (
        <SortableAccountTab
          key={ALL_TAB_ID}
          email={ALL_TAB_ID}
          title={t("allMailboxes")}
          className={tab(allMailboxes)}
          pressed={allMailboxes}
          suppressClick={suppressClick}
          onSelect={() => onSelect([])}
          onContextMenu={(event) => event.preventDefault()}
        >
          {inner}
        </SortableAccountTab>
      );
    }
    const email = id;
    const label = labels.get(email);
    const active =
      selected.length === 1 &&
      selected[0].toLowerCase() === email.toLowerCase();
    const quietTip = quietUntil?.get(email.trim().toLowerCase());
    const awayTip = autoReplyOn?.get(email.trim().toLowerCase());
    const inner = (
      <>
        {quietTip ? (
          <Moon
            className="h-3 w-3 shrink-0 text-stone-400"
            aria-label={quietTip}
          />
        ) : null}
        <AccountMark
          mark={marks[email.trim().toLowerCase()]}
          provider={isOutlookAccount(email) ? "outlook" : "gmail"}
          className={quietTip ? "opacity-60" : undefined}
        />
        <span
          className={cn(
            "max-w-[10rem] truncate",
            quietTip && "text-stone-400"
          )}
        >
          {label?.primary ?? email}
        </span>
        {awayTip ? <AutoReplyBadge title={awayTip} /> : null}
      </>
    );
    const title = quietTip ?? email;
    const className = cn(tab(active), quietTip && !active && "opacity-70");
    if (!sortable) {
      return (
        <button
          key={email}
          type="button"
          title={title}
          aria-pressed={active}
          className={className}
          onClick={() => onSelect([email])}
        >
          {inner}
        </button>
      );
    }
    return (
      <SortableAccountTab
        key={email}
        email={email}
        title={title}
        className={className}
        pressed={active}
        suppressClick={suppressClick}
        /*
          The first press chooses the mailbox. Pressing the one
          already chosen is what opens its picture — the same rule
          the filters follow, where a second press opens the list.
          It drops from the pointer rather than sitting at it,
          because a press is aimed at the tab and not at a spot.
        */
        onSelect={(event) => {
          if (!active) {
            onSelect([email]);
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ account: email, x: box.left, y: box.bottom + 6 });
        }}
        /* And a right-click opens it from any tab, chosen or not. */
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ account: email, x: event.clientX, y: event.clientY });
        }}
      >
        {inner}
      </SortableAccountTab>
    );
  };

  return (
    <>
      {/* The tabs sit on a track, so the chosen one reads as a card lifted
          out of the row rather than as one word among four.

          The row scrolls sideways: four mailboxes do not fit a sidebar, and
          the answer is to reach the fifth rather than to squeeze all five
          into a width that suits none of them.

          The track is the scroller, not the thing inside it. A track as wide
          as every tab was cut off square at the column's edge whenever it
          outran the column, so its rounded end was only ever seen after
          scrolling to it. Now the track stops at the edge, rounded, and the
          tabs scroll inside it. `w-fit max-w-full`: as wide as the tabs when
          they fit, and no wider than the column when they do not. */}
      <div
        className={cn(
          "w-fit max-w-full overflow-x-auto rounded-full bg-[var(--mail-segment-track)] p-1 [scrollbar-width:thin]"
        )}
      >
        <div className="flex w-max items-center gap-1">
          {selectOnly ? (
            rowIds.map((id) => renderTab(id, false))
          ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => {
              suppressClick.current = true;
            }}
            onDragEnd={onDragEnd}
          >
          <SortableContext
            items={rowIds}
            strategy={horizontalListSortingStrategy}
          >
          {rowIds.map((id) => renderTab(id, true))}
          </SortableContext>
          </DndContext>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
      {menu ? (
        <MarkMenu
          x={menu.x}
          y={menu.y}
          hasOwnMark={Boolean(marks[menu.account.trim().toLowerCase()])}
          onChoose={() => {
            forRef.current = menu.account;
            setMenu(null);
            fileRef.current?.click();
          }}
          onReset={() => {
            setAccountMark(menu.account, null);
            setMenu(null);
          }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

/**
 * A row button under the tabs: the folders, and the filters.
 *
 * The glyph alone. A folder and a funnel are two of the few pictures that
 * need no caption, and the name is a hover and a screen reader away — so the
 * row stays a row of controls rather than a second row of words under a row
 * of words.
 */
export function MailRowButton({
  icon: Icon,
  label,
  active,
  onNavy = false,
  onClick,
  ...rest
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Lit: the folders are showing, or a filter is narrowing the list. */
  active?: boolean;
  onNavy?: boolean;
  onClick: () => void;
} & Omit<React.ComponentPropsWithoutRef<"button">, "onClick" | "className">) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      aria-label={label}
      className={cn(
        // No outline. A ring around a glyph reads as a chosen thing, and
        // this one is not chosen — it is either doing something or it is
        // not, and the colour is enough to say which.
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
        active
          ? "text-teal-700 hover:bg-teal-600/10"
          : onNavy
            ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
            : "text-stone-500 hover:bg-[var(--mail-chrome-hover)] hover:text-stone-800"
      )}
      {...rest}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
