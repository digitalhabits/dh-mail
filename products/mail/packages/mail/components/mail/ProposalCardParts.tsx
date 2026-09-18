"use client";

/**
 * The parts every Update CRM proposal is drawn from.
 *
 * One vocabulary, borrowed from To-Do's task composer: a white card holds
 * the proposal's own words as text without a box round it, and a row of
 * chips holds its properties. A chip that holds a value is filled; one that
 * does not is an outline. Named values (a column of a record, a job title)
 * sit in rows of name and value inside the card, and people are drawn as the
 * board draws them, with an avatar in their colour.
 *
 * The look follows todo.css (`.composer-chip`, `.assign-menu`). The mail
 * interface is built without the To-Do package, so the parts are drawn here
 * with the mail's own classes, which the dark theme already answers.
 */

import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { colourForPerson, initialsOf } from "@/lib/mail/task-people";
import { cn } from "@/lib/utils";

/** An unset chip: an outline. */
export const chipClass =
  "inline-flex h-[26px] min-w-0 items-center gap-[5px] rounded-full border border-stone-300 bg-transparent px-2.5 text-[12.5px] leading-none text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800";

/** A chip that holds a value: filled, no outline, the value in bold. */
export const chipSetClass =
  "border-transparent bg-stone-100 font-semibold text-stone-800 hover:bg-stone-200";

/** A field inside a chip: no box of its own, the chip is the box. */
export const chipInputClass =
  "min-w-0 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-stone-800 shadow-none outline-none placeholder:font-normal placeholder:text-stone-400 focus:ring-0";

/** A value in a row of name and value: a box only while it is being edited. */
export const bareFieldClass =
  "w-full min-w-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-sm text-stone-900 shadow-none outline-none placeholder:text-stone-400 hover:bg-stone-100 focus:bg-white focus:ring-1 focus:ring-teal-600";

/** The size a chip's icon is drawn at. */
export const chipIconClass = "h-3.5 w-3.5 shrink-0";

/** The card a proposal's own words and properties sit on. */
export function ProposalCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-stone-200 bg-white px-3 pb-2.5 pt-2 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Keeps a text box as tall as its text. Measured again when the box changes
 * width: the first measure can come before the dialog has its width, and a
 * narrow measure leaves the box lines too tall.
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string
) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const frame = requestAnimationFrame(fit);
    let lastWidth = el.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (el.clientWidth === lastWidth) return;
            lastWidth = el.clientWidth;
            fit();
          });
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [ref, value]);
}

const cardWordsClass =
  "w-full border-0 bg-transparent p-0 shadow-none outline-none placeholder:text-stone-400 focus:ring-0";

/** One line of the card's own words: a title, a name. */
export function CardLine({
  value,
  onChange,
  ariaLabel,
  placeholder,
  strong = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  strong?: boolean;
}) {
  return (
    <input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        cardWordsClass,
        strong ? "text-[15px] font-medium text-stone-900" : "text-sm text-stone-700"
      )}
    />
  );
}

/** The card's own words over several lines: a note, a next step. */
export function CardText({
  value,
  onChange,
  ariaLabel,
  placeholder,
  strong = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  strong?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(ref, value);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        cardWordsClass,
        "block max-h-48 resize-none overflow-y-auto leading-snug",
        strong ? "text-[15px] font-medium text-stone-900" : "text-sm text-stone-700",
        className
      )}
    />
  );
}

/** The row of chips under a card's words. */
export function ChipRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-2.5 flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </div>
  );
}

/** A row of a menu: what it is, and a tick when it is chosen. */
export function MenuRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 hover:bg-stone-100",
        selected && "bg-stone-100"
      )}
    >
      {children}
      {selected ? (
        <Check className="ml-auto h-4 w-4 shrink-0 text-stone-800" strokeWidth={2.5} aria-hidden />
      ) : null}
    </button>
  );
}

/**
 * A chip that picks one of a list. Filled while it holds a value; a value the
 * list does not have is still shown, so the reader sees what they would
 * replace.
 */
export function ChipMenu({
  icon,
  label,
  value,
  placeholder,
  display,
  options,
  onPick,
  menuWidth = "w-56",
  className,
}: {
  icon?: React.ReactNode;
  /** What the chip chooses, for its title and the menu's name. */
  label: string;
  value: string;
  /** Shown while nothing is chosen. The label when not given. */
  placeholder?: string;
  /** Drawn in the chip instead of the chosen option's words. */
  display?: React.ReactNode;
  options: { value: string; label: string; render?: React.ReactNode }[];
  onPick: (value: string) => void;
  menuWidth?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const picked = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(chipClass, value && chipSetClass, className)}
        >
          {icon}
          {display ?? (
            <span className="max-w-[16rem] truncate">
              {value ? (picked?.label ?? value) : (placeholder ?? label)}
            </span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        align="start"
        className={cn("max-h-72 overflow-y-auto rounded-xl p-1.5", menuWidth)}
      >
        <div role="listbox" aria-label={label}>
          {options.map((o) => (
            <MenuRow
              key={o.value || "(none)"}
              selected={o.value === value}
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              {o.render ?? <span className="min-w-0 flex-1 truncate">{o.label}</span>}
            </MenuRow>
          ))}
        </div>
      </MailPopoverContent>
    </Popover>
  );
}

/** A chip holding its own field: a date, a time, a length, a place. */
export function ChipField({
  icon,
  title,
  set = true,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  /** Filled while it holds something. */
  set?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label title={title} className={cn(chipClass, set && chipSetClass, "cursor-text")}>
      {icon}
      {children}
    </label>
  );
}

/** Rows of name and value inside a card, the way a record lists its columns. */
export function PropertyList({
  children,
  first = false,
}: {
  children: React.ReactNode;
  /** The card has nothing above the rows, so no rule over them. */
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-stone-100",
        first ? "" : "mt-2.5 border-t border-stone-100"
      )}
    >
      {children}
    </div>
  );
}

export function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 py-0.5">
      <span className="truncate text-[12.5px] text-stone-500" title={label}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The small capitals over a part of a card. */
export function CardHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
      {children}
    </p>
  );
}

/** A person as the board draws them: their photo, or initials in their colour. */
export function PersonAvatar({
  name,
  colour,
  photoUrl,
  size,
}: {
  name: string;
  colour?: string | null;
  photoUrl?: string | null;
  size: number;
}) {
  const [photoFailed, setPhotoFailed] = React.useState(false);
  React.useEffect(() => setPhotoFailed(false), [photoUrl]);
  if (photoUrl && !photoFailed) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setPhotoFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none tracking-[0.02em] text-white"
      style={{
        width: size,
        height: size,
        background: colourForPerson(name, colour),
        fontSize: size * 0.36,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * A person on a proposal: an avatar, their name, their address, and their job
 * title when the thread gave one. A part left undefined is not drawn.
 */
export function PersonLine({
  name,
  email,
  title,
  onChange,
  onRemove,
  labels,
}: {
  name?: string;
  email: string;
  title?: string;
  onChange: (patch: { name?: string; email?: string; title?: string }) => void;
  onRemove?: () => void;
  labels: { name: string; email: string; title: string; remove: string };
}) {
  const shown = (name ?? "").trim() || email.trim() || "?";
  const columns =
    name === undefined
      ? ""
      : title === undefined
        ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
        : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]";
  return (
    <div className="flex items-center gap-2 py-0.5">
      <PersonAvatar name={shown} size={24} />
      <div className={cn("grid min-w-0 flex-1 grid-cols-1 gap-x-1", columns)}>
        {name !== undefined ? (
          <input
            aria-label={labels.name}
            placeholder={labels.name}
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn(bareFieldClass, "font-medium")}
          />
        ) : null}
        <input
          type="email"
          aria-label={labels.email}
          placeholder={labels.email}
          value={email}
          onChange={(e) => onChange({ email: e.target.value })}
          className={cn(bareFieldClass, name === undefined ? "text-stone-900" : "text-stone-600")}
        />
        {title !== undefined ? (
          <input
            aria-label={labels.title}
            placeholder={labels.title}
            value={title}
            onChange={(e) => onChange({ title: e.target.value })}
            className={cn(bareFieldClass, "text-stone-600")}
          />
        ) : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          aria-label={labels.remove}
          title={labels.remove}
          onClick={onRemove}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
