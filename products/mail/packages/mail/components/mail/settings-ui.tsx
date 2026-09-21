"use client";

/**
 * The furniture every settings surface is built from.
 *
 * One vocabulary, borrowed from Digital Habits: Blocker, which is the app most
 * of these readers meet first. A heading names a section; a group holds its
 * rows on a tinted card with hairlines between them; a row says what it is on
 * the left and holds its control on the right.
 *
 * It lives here rather than in each panel because four surfaces were drifting
 * apart — the same switch was three sizes, and the same button was two
 * colours, depending on which dialog you had opened.
 *
 * Colours are named with the stone scale on purpose. `mail.css` maps those
 * classes to the dark theme's own variables, so a panel built from them
 * follows the theme without asking.
 */

import * as React from "react";
import { ChevronLeft, ChevronsUpDown, X } from "lucide-react";

import {
  LANGUAGE_FLAG_SVG,
  LANGUAGE_NATIVE_LABELS,
  useMailLang,
  useMailT,
  type MailLang,
} from "@/lib/mail/i18n";
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  nextUiScaleStop,
} from "@/lib/mail/ui-scale";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { useUiScale } from "@/lib/mail/use-ui-scale";
import { cn } from "@/lib/utils";
import { useCardDrag } from "@/components/mail/use-card-drag";

/** The small capitals over a section. */
export function SettingsHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-1.5 mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400 first:mt-0",
        className
      )}
    >
      {children}
    </p>
  );
}

/**
 * A section's rows, on one card.
 *
 * A tint rather than a border: the card is a background for its rows, and a
 * stack of outlined boxes is what made these panels read as a pile of
 * unrelated switches in the first place.
 */
export function SettingsGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // The cream the title bar and the thread list are painted in, so a
        // panel over them is the same surface rather than a grey card on top.
        // The variable, not the colour: it is what turns navy in dark mode.
        "divide-y divide-stone-200 overflow-hidden rounded-xl bg-[var(--mail-chrome)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingsRow({
  label,
  hint,
  control,
  onClick,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  control?: React.ReactNode;
  /** Makes the whole row the control — for a row that opens something. */
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5 text-left">
        <span className="text-sm text-stone-800">{label}</span>
        {hint ? (
          <span className="text-xs leading-snug text-stone-500">{hint}</span>
        ) : null}
      </span>
      {control ? <span className="shrink-0">{control}</span> : null}
    </>
  );
  const shape = cn(
    "flex w-full items-center justify-between gap-3 px-4 py-3",
    className
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(shape, "text-left transition-colors hover:bg-stone-200/50")}
      >
        {body}
      </button>
    );
  }
  return <div className={shape}>{body}</div>;
}

/**
 * A row whose control sits under its label rather than beside it.
 *
 * For a text box, which needs the width — beside a label it would be a slot
 * too narrow to read what you typed into it.
 */
export function SettingsStackedRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-sm text-stone-800">{label}</p>
      {hint ? (
        <p className="mt-0.5 text-xs leading-snug text-stone-500">{hint}</p>
      ) : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** One switch, one size, wherever it appears. */
export function SettingsToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What the switch is for, for anybody not reading the row beside it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative block h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-teal-600" : "bg-stone-300"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]",
          checked ? "left-4" : "left-0.5"
        )}
      />
    </button>
  );
}

/** A flag, at the size the picker draws them. */
function LanguageFlag({ lang }: { lang: MailLang }) {
  return (
    <span
      aria-hidden
      className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: LANGUAGE_FLAG_SVG[lang] }}
    />
  );
}

/**
 * The language row, at the top of General.
 *
 * The same picker Blocker and To-Do show: the current language on the button,
 * and a list under it that names what you are on before it offers the others.
 * Two languages make that list one line long, but the shape stays the same as
 * the other apps, and a third language drops in without a redesign.
 */
/**
 * How big the whole app is drawn.
 *
 * A minus, the size, and a plus — the same three the thread's own zoom has,
 * because a reader who has found one of them knows what the other does. The
 * number itself is the way back to 100%: it is a button, and pressing it
 * puts the app back where it started, which is quicker than counting steps
 * down and is the thing a reader wants after overshooting.
 */
export function SettingsTextSizeRow() {
  const t = useMailT();
  const [scale, setScale] = useUiScale();
  const percent = Math.round(scale * 100);
  const step = (direction: 1 | -1) => setScale(nextUiScaleStop(scale, direction));
  const smallerHint = `${t("smallerText")} (${formatShortcut({ key: "-", meta: true, alt: true })})`;
  const biggerHint = `${t("biggerText")} (${formatShortcut({ key: "+", meta: true, alt: true })})`;
  const resetHint = `${t("resetTextSize")} (${formatShortcut({ key: "0", meta: true, alt: true })})`;
  const buttonClass =
    "rounded-full px-1.5 text-[15px] leading-none text-stone-500 hover:bg-stone-200/70 hover:text-stone-800 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <SettingsRow
      label={t("appTextSize")}
      hint={t("appTextSizeHint")}
      control={
        <span className="flex items-center gap-0.5 rounded-full border border-stone-200 bg-white px-1.5 py-1">
          <button
            type="button"
            aria-label={smallerHint}
            title={smallerHint}
            disabled={scale <= UI_SCALE_MIN}
            onClick={() => step(-1)}
            className={buttonClass}
          >
            −
          </button>
          {/* The widest label sizes the cell so the row does not shuffle
              as the number changes — the same trick as ZoomControls. */}
          <span className="grid text-[11px] tabular-nums text-stone-500">
            <span className="invisible col-start-1 row-start-1" aria-hidden>
              100%
            </span>
            <button
              type="button"
              title={resetHint}
              aria-label={resetHint}
              disabled={scale === 1}
              onClick={() => setScale(1)}
              className="col-start-1 row-start-1 text-center hover:text-stone-800 disabled:hover:text-stone-500"
            >
              {percent}%
            </button>
          </span>
          <button
            type="button"
            aria-label={biggerHint}
            title={biggerHint}
            disabled={scale >= UI_SCALE_MAX}
            onClick={() => step(1)}
            className={buttonClass}
          >
            +
          </button>
        </span>
      }
    />
  );
}

export function SettingsLanguageRow() {
  const t = useMailT();
  const [lang, setLang] = useMailLang();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const others = (Object.keys(LANGUAGE_NATIVE_LABELS) as MailLang[]).filter(
    (option) => option !== lang
  );

  // A click anywhere else, or Escape, shuts the list. The settings panel is
  // itself a popover, so this cannot use one of those without nesting them.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <SettingsRow
      label={t("language")}
      control={
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            aria-label={t("language")}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              // The theme menu beside it is a native select, so this borrows
              // its box to keep the two rows on one line of type.
              "flex cursor-pointer items-center gap-2 rounded-md border border-stone-200 bg-white py-1 pl-2.5 pr-2 text-xs text-stone-700 outline-none hover:bg-stone-50",
              open && "ring-1 ring-teal-600/40"
            )}
          >
            <LanguageFlag lang={lang} />
            <span>{LANGUAGE_NATIVE_LABELS[lang]}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-stone-400" aria-hidden />
          </button>
          {open ? (
            <div
              role="listbox"
              aria-label={t("language")}
              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
            >
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                {t("languagePickerCurrent")}
              </p>
              <div
                role="option"
                aria-selected
                className="mx-1 flex items-center gap-2 rounded-md bg-stone-100 px-2 py-1.5 text-sm text-stone-800"
              >
                <LanguageFlag lang={lang} />
                <span>{LANGUAGE_NATIVE_LABELS[lang]}</span>
              </div>
              <div className="my-1 h-px bg-stone-200" />
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                {t("languagePickerSwitch")}
              </p>
              {others.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setLang(option);
                    setOpen(false);
                  }}
                  className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100"
                >
                  <LanguageFlag lang={option} />
                  <span>{LANGUAGE_NATIVE_LABELS[option]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      }
    />
  );
}

export const settingsPrimaryButton =
  "rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60";

export const settingsSecondaryButton =
  "rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-60";

/**
 * One category's page in Settings.
 *
 * A title, a line that says what the category is for, the rows, and a footer
 * with Done. The rows scroll and the footer does not, so the way out stays on
 * screen however long the list gets. Every category has the same frame, so
 * moving along the rail changes only what is in it.
 */
export function SettingsPane({
  title,
  description,
  onDone,
  footerStart,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onDone: () => void;
  /** Buttons for this category only, such as a reset, left of Done. */
  footerStart?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useMailT();
  return (
    <>
      <div className="px-6 pb-3 pt-5">
        <h2 className="font-serif text-2xl font-bold text-stone-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-snug text-stone-500">{description}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
      <div className="flex items-center gap-2 border-t border-stone-200 px-6 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2">{footerStart}</div>
        <button type="button" className={settingsSecondaryButton} onClick={onDone}>
          {t("done")}
        </button>
      </div>
    </>
  );
}

/**
 * The shell every settings dialog sits in.
 *
 * A title, an optional line saying what the dialog is for, the body, and a
 * footer that holds the buttons. The body scrolls and the footer does not, so
 * the way out stays on screen however long the list inside gets.
 */
export function SettingsDialog({
  title,
  subtitle,
  nav,
  onBack,
  backLabel,
  onClose,
  children,
  footer,
  width = "w-[520px]",
  closeLabel = "Close",
  bare = false,
  draggable = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /**
   * Tabs under the title, outside the scrolling body.
   *
   * Which account you are editing has to stay on screen while you scroll
   * through what you are editing about it.
   */
  nav?: React.ReactNode;
  /**
   * A way back into the panel that opened this dialog.
   *
   * The cross shuts everything. Without this, a row that left Settings
   * has no way to return to the list it left.
   */
  onBack?: () => void;
  /** The name of the panel this goes back to — Settings, when it is that. */
  backLabel?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  closeLabel?: string;
  /**
   * Drop the corner cross and the line over the footer.
   *
   * A dialog that asks one question and offers both answers as buttons has
   * no use for a third way out, and no list under the question long enough
   * for the footer to need a line holding it away from one. Escape and the
   * backdrop still shut it.
   */
  bare?: boolean;
  /**
   * The card can be carried out of the way by its heading.
   *
   * For a dialog whose answer is in what it covers: the CRM proposals are
   * read against the thread that earned them, and a reader checking a
   * quoted line had no way to see it. Off by default — a settings panel
   * covers nothing anybody needs, and a card that slides under the hand is
   * worse than one that stays where it was put.
   *
   * It also leaves what it covers alive — the thread scrolls under the card
   * and can be clicked into, and the backdrop no longer shuts the dialog.
   * See `seeThrough` below.
   */
  draggable?: boolean;
}) {
  const t = useMailT();
  const titleId = React.useId();
  // See useCardDrag: the same carry the floating reply uses.
  const { cardRef, startDrag, cardStyle } = useCardDrag(draggable);

  /**
   * Escape shuts it.
   *
   * On the bubble phase, so a dialog that reads keys itself — the shortcut
   * editor does — can take Escape first and use it to stop reading, rather
   * than losing the dialog under it.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /*
    A dialog that is read against what it covers leaves what it covers
    alive: the thread scrolls under it, and a line can be clicked into,
    without the card going away. The same fact that makes such a card
    draggable makes its backdrop nothing but a shade — so the two follow
    from one flag rather than from two that are always set together.

    The way out is then the cross and Escape. A press on the thread means
    "let me look at that", which is the opposite of "put this away", so it
    would be a poor thing to shut the dialog with.
  */
  const seeThrough = draggable;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-6",
        seeThrough && "pointer-events-none"
      )}
    >
      <div
        className={cn("absolute inset-0 bg-black/20", seeThrough && "pointer-events-none")}
        onClick={seeThrough ? undefined : onClose}
        aria-hidden
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          /*
            88% of the window, and of the window by both measures.

            The card is held in the middle of the screen, so a card taller
            than the screen hangs off both ends of it — and the end that is
            out of reach is the top, which is the heading, which is the
            handle it is carried by. A reader then has a card they can
            neither read the top of nor move.

            `--mail-viewport-h` is the window in the pixels the app lays
            out in: `zoom` scales lengths and does not scale `vh`, so on
            that path `dvh` is too big. But the variable is measured, and a
            measurement can be out of date — the shell's zoom is set over
            an async call, so the pass that writes the variable can run
            before the zoom it is writing it for. Then the variable is too
            big instead.

            Neither is ever too small, so the smaller of the two is the
            window whichever path is in use and whatever has just changed.
          */
          "relative flex max-h-[calc(min(var(--mail-viewport-h,100dvh),100dvh)*0.88)] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl",
          // The card itself still answers the pointer when the shade does not.
          seeThrough && "pointer-events-auto",
          width
        )}
        style={cardStyle}
      >
        <div
          className={cn(
            "flex items-start justify-between gap-3 px-6 pt-5",
            draggable && "cursor-grab touch-none select-none active:cursor-grabbing"
          )}
          onPointerDown={startDrag}
        >
          <div className="flex min-w-0 items-center gap-2">
            {onBack ? (
              <button
                type="button"
                aria-label={t("back")}
                className="-ml-1.5 flex shrink-0 items-center gap-0.5 rounded-md py-1 pl-0.5 pr-1.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                onClick={onBack}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {backLabel ?? t("settings")}
              </button>
            ) : null}
            <h2
              id={titleId}
              className="font-serif text-xl font-bold text-stone-900"
            >
              {title}
            </h2>
          </div>
          {bare ? null : (
            <button
              type="button"
              aria-label={closeLabel}
              className="-mr-1.5 shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {subtitle ? (
          <p
            className={cn(
              "px-6 pt-1 text-sm text-stone-600",
              draggable && "cursor-grab select-none active:cursor-grabbing"
            )}
            onPointerDown={startDrag}
          >
            {subtitle}
          </p>
        ) : null}
        {nav ? <div className="mt-3 px-6">{nav}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer ? (
          <div
            className={cn(
              "flex items-center justify-end gap-2 px-6",
              bare ? "pb-5" : "border-t border-stone-200 py-3"
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
