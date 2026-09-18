"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useMailTheme, type MailTheme } from "@/lib/mail/theme";
import { MailAccountsPanel } from "@/components/mail/MailAccountsPanel";
import { useLoadImagesByDefault } from "@/components/mail/MailBubble";
import { useMailListPlacement } from "@/components/mail/use-mail-layout";
import { BookOpen, ChevronDown, Command, Mail, Mails, Moon, RefreshCw, Search, Settings, Settings2, Users, type LucideIcon } from "lucide-react";
import { beginNativeWindowDragOnMove } from "@/lib/native-shell";
import { type AutoReplyDto } from "@/components/mail/AutoReplyDialog";
import { ContactSourcesPanel } from "@/components/mail/ContactSourcesDialog";
import { setMailListPlacement, type MailListPlacement } from "@/lib/mail/layout";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { MailShortcutsPanel } from "@/components/mail/MailShortcutsDialog";
import { SnoozeOptionsPanel } from "@/components/mail/SnoozeOptionsPanel";
import { SettingsGroup, SettingsLanguageRow, SettingsPane, SettingsTextSizeRow, SettingsRow, SettingsToggle } from "@/components/mail/settings-ui";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { OPEN_MAIL_ACCOUNTS_EVENT, isMailSettingsCategory, type MailSettingsCategory } from "@/lib/mail/open-mail-accounts-menu";
import { MAIL_APP_VERSION } from "@/lib/mail/app-version";
import { cn } from "@/lib/utils";

export type MailViewMode = "threads" | "people";

/** Spacious multi-line rows vs dense one-line rows in the mail list. */
export type MailListDensity = "comfortable" | "compact";

/** Two spaced lines — comfortable / multi-line list density. */
function ListDensityComfortableIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="5" y1="15" x2="19" y2="15" />
    </svg>
  );
}

/** Four tight lines — compact / one-line list density. */
function ListDensityCompactIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <line x1="5" y1="6.5" x2="19" y2="6.5" />
      <line x1="5" y1="10.5" x2="19" y2="10.5" />
      <line x1="5" y1="14.5" x2="19" y2="14.5" />
      <line x1="5" y1="18.5" x2="19" y2="18.5" />
    </svg>
  );
}

/**
 * Outlook-style sync: arrowheads at 12 o'clock and 6 o'clock.
 * Spin wraps the rotated glyph so transform does not fight animate-spin.
 */
export function SyncIcon({
  className,
  spinning = false,
}: {
  className?: string;
  spinning?: boolean;
}) {
  return (
    <span className={cn("inline-flex", spinning && "animate-spin")}>
      <RefreshCw className={cn("-rotate-45", className)} aria-hidden />
    </span>
  );
}

const MAIL_LIST_LAYOUTS: {
  id: MailListPlacement;
  label: MailStringKey;
  diagram: MailListPlacement;
}[] = [
  { id: "left", label: "layoutLeft", diagram: "left" },
  { id: "right", label: "layoutRight", diagram: "right" },
  { id: "top", label: "layoutTop", diagram: "top" },
  { id: "bottom", label: "layoutBottom", diagram: "bottom" },
];

function MailListLayoutDiagram({
  diagram,
  selected,
}: {
  diagram: MailListPlacement;
  selected: boolean;
}) {
  return (
    <span
      className={cn(
        "relative block h-8 w-10 overflow-hidden rounded-[3px] border",
        selected
          ? "border-teal-600 bg-teal-50"
          : "border-stone-300 bg-white"
      )}
      aria-hidden
    >
      <span className="absolute inset-0.5 rounded-[1px] bg-stone-100" />
      <span
        className={cn(
          "absolute bg-stone-400/80",
          diagram === "left" && "bottom-0.5 left-0.5 top-0.5 w-[30%]",
          diagram === "right" && "bottom-0.5 right-0.5 top-0.5 w-[30%]",
          diagram === "top" && "left-0.5 right-0.5 top-0.5 h-[30%]",
          diagram === "bottom" && "bottom-0.5 left-0.5 right-0.5 h-[30%]"
        )}
      />
    </span>
  );
}

/** Toggle list density (relaxed ↔ compact) — toolbar control next to expand. */
export function ListDensityToggle({
  density,
  onChange,
  onNavy = false,
}: {
  density: MailListDensity;
  onChange: (density: MailListDensity) => void;
  onNavy?: boolean;
}) {
  const t = useMailT();
  const compact = density === "compact";
  return (
    <button
      type="button"
      title={compact ? t("relaxedList") : t("compactList")}
      aria-label={compact ? t("relaxedDensity") : t("compactDensity")}
      aria-pressed={compact}
      className={cn(
        "rounded-md p-1.5",
        onNavy
          ? "text-white/70 hover:bg-white/10 hover:text-white"
          : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
      )}
      onPointerDown={beginNativeWindowDragOnMove}
      onClick={() => onChange(compact ? "comfortable" : "compact")}
    >
      {compact ? (
        <ListDensityCompactIcon className="h-4 w-4" />
      ) : (
        <ListDensityComfortableIcon className="h-4 w-4" />
      )}
    </button>
  );
}

/** Icon tabs: group the list by thread or by person. */
export function MailViewModeTabs({
  viewMode,
  onChange,
  onNavy = false,
  vertical = false,
}: {
  viewMode: MailViewMode;
  onChange: (mode: MailViewMode) => void;
  onNavy?: boolean;
  /** Stack icons in the narrow avatar rail. */
  vertical?: boolean;
}) {
  const t = useMailT();
  const options = [
    { id: "threads" as const, label: t("byThread"), Icon: Mails },
    { id: "people" as const, label: t("byPerson"), Icon: Users },
  ];
  return (
    <div
      role="tablist"
      aria-label={t("listGrouping")}
      className={cn(
        // The same three tokens the mailbox tabs use, on the darker of the
        // two tracks: this one sits in the title bar, which is a step up
        // from the chrome the mailbox row is on.
        "flex shrink-0 rounded-md bg-[var(--mail-segment-track-strong)] p-0.5",
        vertical ? "flex-col gap-0.5" : "items-center gap-0.5"
      )}
    >
      {options.map(({ id, label, Icon }) => {
        const selected = viewMode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            title={label}
            aria-label={label}
            aria-selected={selected}
            onPointerDown={beginNativeWindowDragOnMove}
            onClick={() => onChange(id)}
            className={cn(
              "rounded p-1",
              selected
                ? "bg-[var(--mail-segment-active)] text-[var(--mail-segment-active-fg)] shadow-sm"
                : "text-[var(--mail-segment-fg)] hover:text-[var(--mail-segment-active-fg)]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Pane position, display prefs, and connected mailboxes. */
export function MailLayoutMenu({
  onNavy = false,
  align = "start",
  knownEmails,
  onVisibilityChange,
  onAccountsChanged,
  autoReplies,
  onSetUpAutoReply,
  onEndAutoReply,
  ownIdentity,
  onOwnIdentityChange,
}: {
  /** Trigger sits on the navy list chrome. */
  onNavy?: boolean;
  /** Popover alignment — use `end` when the trigger is on the right of the title bar. */
  align?: "start" | "end" | "center";
  knownEmails: string[];
  onVisibilityChange: (email: string, inMailTab: boolean) => void;
  onAccountsChanged: () => void;
  autoReplies: AutoReplyDto[];
  onSetUpAutoReply: (account: string) => void;
  onEndAutoReply: (account: string) => void;
  ownIdentity?: { addresses: string[]; domains: string[] };
  onOwnIdentityChange?: (next: {
    addresses: string[];
    domains: string[];
  }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  /**
   * The page the rail has open. It is kept when Settings closes: the rail
   * shows which page it is, so opening on the last one is not a surprise, and
   * it is where somebody who just closed Settings wants to be again.
   */
  const [category, setCategory] = React.useState<MailSettingsCategory>("accounts");
  const [query, setQuery] = React.useState("");
  const placement = useMailListPlacement();
  const [loadImagesByDefault, setLoadImagesByDefault] =
    useLoadImagesByDefault();
  const [theme, setTheme] = useMailTheme();
  const t = useMailT();

  // Opened from the mailbox filter next to search, the app menu, or a dialog
  // that goes back to one page. One menu is mounted, so this cannot open two
  // at once.
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const wanted =
        event instanceof CustomEvent
          ? (event.detail as { category?: unknown } | null)?.category
          : undefined;
      if (isMailSettingsCategory(wanted)) setCategory(wanted);
      setOpen(true);
    };
    window.addEventListener(OPEN_MAIL_ACCOUNTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MAIL_ACCOUNTS_EVENT, onOpen);
  }, []);

  // A search is for this visit. Settings opens again with the whole rail.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const close = () => setOpen(false);

  /**
   * The rail. Each category lists the words of the settings on its page, so
   * a search for "theme" finds General, where the theme is.
   */
  const categories: {
    id: MailSettingsCategory;
    label: string;
    Icon: LucideIcon;
    count?: number;
    words: string[];
  }[] = [
    {
      id: "accounts",
      label: t("accounts"),
      Icon: Mail,
      count: knownEmails.length || undefined,
      words: [t("yourOtherAddresses"), t("colleagueDomains"), t("autoReply"), "Gmail", "Outlook"],
    },
    {
      id: "general",
      label: t("general"),
      Icon: Settings2,
      words: [t("language"), t("theme"), t("themeDark"), t("themeLight"), t("textSize")],
    },
    {
      id: "reading",
      label: t("settingsReading"),
      Icon: BookOpen,
      words: [t("readingPane"), t("loadImages")],
    },
    {
      id: "snooze",
      label: t("settingsSnoozeSchedule"),
      Icon: Moon,
      words: [t("snooze"), t("snoozeOptions"), t("sendLater"), t("pauseFetching"), t("pauseSection")],
    },
    {
      id: "contacts",
      label: t("settingsContacts"),
      Icon: Users,
      words: [t("contactSources"), t("sourceMailHistory"), t("sourceMacContacts")],
    },
    {
      id: "shortcuts",
      label: t("keyboardShortcuts"),
      Icon: Command,
      words: [],
    },
  ];
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? categories.filter((c) =>
        [c.label, ...c.words].some((word) => word.toLocaleLowerCase().includes(needle))
      )
    : categories;
  // The page follows the search: when the open page is filtered out, the
  // first page that matches is shown instead.
  const shown = matches.some((c) => c.id === category)
    ? category
    : (matches[0]?.id ?? category);

  let pane: React.ReactNode;
  switch (shown) {
    case "accounts":
      pane = (
        <SettingsPane
          title={t("accounts")}
          description={t("settingsAccountsHint")}
          onDone={close}
        >
          <MailAccountsPanel
            knownEmails={knownEmails}
            onVisibilityChange={onVisibilityChange}
            onChanged={onAccountsChanged}
            autoReplies={autoReplies}
            onSetUpAutoReply={onSetUpAutoReply}
            onEndAutoReply={onEndAutoReply}
            onRequestClose={close}
            ownIdentity={ownIdentity}
            onOwnIdentityChange={onOwnIdentityChange}
          />
        </SettingsPane>
      );
      break;
    case "general":
      pane = (
        <SettingsPane
          title={t("general")}
          description={t("settingsGeneralHint")}
          onDone={close}
        >
          <SettingsGroup>
            {/* Language first: it decides what every row below it says. Then
                appearance, running colour → size. */}
            <SettingsLanguageRow />
            <SettingsRow
              label={t("theme")}
              control={
                // A menu, not three buttons. The operating system draws it, so
                // it is the list a Mac reader already knows, with the current
                // choice ticked — and it stays one line however many there are.
                <span className="relative inline-flex items-center">
                  <select
                    aria-label={t("theme")}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as MailTheme)}
                    className="cursor-pointer appearance-none rounded-md border border-stone-200 bg-white py-1 pl-2.5 pr-7 text-xs text-stone-700 outline-none hover:bg-stone-50"
                  >
                    <option value="system">{t("themeSystem")}</option>
                    <option value="light">{t("themeLight")}</option>
                    <option value="dark">{t("themeDark")}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-stone-400" />
                </span>
              }
            />
            <SettingsTextSizeRow />
          </SettingsGroup>
        </SettingsPane>
      );
      break;
    case "reading":
      pane = (
        <SettingsPane
          title={t("settingsReading")}
          description={t("settingsReadingHint")}
          onDone={close}
        >
          <SettingsGroup>
            <SettingsRow
              label={t("readingPane")}
              hint={t("readingPaneHint")}
              control={
                <span className="flex gap-1">
                  {MAIL_LIST_LAYOUTS.map((option) => {
                    const selected = placement === option.id;
                    const label = t(option.label);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-pressed={selected}
                        onClick={() => setMailListPlacement(option.id)}
                        className={cn(
                          "rounded-md p-1 transition-colors",
                          selected ? "bg-teal-50" : "hover:bg-stone-100"
                        )}
                      >
                        <MailListLayoutDiagram
                          diagram={option.diagram}
                          selected={selected}
                        />
                      </button>
                    );
                  })}
                </span>
              }
            />
            <SettingsRow
              label={t("loadImages")}
              hint={t("loadImagesHint")}
              control={
                <SettingsToggle
                  checked={loadImagesByDefault}
                  onChange={setLoadImagesByDefault}
                  label={t("loadImages")}
                />
              }
            />
          </SettingsGroup>
        </SettingsPane>
      );
      break;
    case "snooze":
      pane = <SnoozeOptionsPanel onDone={close} />;
      break;
    case "contacts":
      pane = <ContactSourcesPanel onDone={close} />;
      break;
    case "shortcuts":
      pane = <MailShortcutsPanel onDone={close} />;
      break;
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("settings")}
          aria-label={t("settings")}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "rounded-md p-1.5",
            onNavy
              ? open
                ? "bg-white/15 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
              : open
                ? "bg-stone-200/70 text-stone-900"
                : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
          )}
          onPointerDown={beginNativeWindowDragOnMove}
        >
          {/* A cog: the sign for settings that people already know. */}
          <Settings className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      {/*
        Dim what is behind the settings panel.

        This one panel holds most of what the app can be told, so it is worth
        setting apart from the mail behind it. The other menus are one
        decision each and would be smothered by this.

        A popover has no overlay of its own, so this is one. It goes on
        `body`, because the trigger sits in the title bar and an element
        rendered there would be dimming from inside the thing it dims.
      */}
      {open && typeof document !== "undefined"
        ? createPortal(
            // The same wash the settings dialogs already use, so opening
            // Contact sources from here does not change the shade.
            <div className="fixed inset-0 z-40 bg-black/20" aria-hidden />,
            document.body
          )
        : null}
      <MailPopoverContent
        align={align}
        /**
         * A category rail and the page it has open.
         *
         * One long list had grown past what anybody would scroll through, so
         * each kind of setting has its own page. The panel is one size for
         * every page, so moving along the rail does not make it jump.
         *
         * As tall as the space under the button, and no taller. Radix
         * measures that gap in window pixels; under the CSS-zoom fallback the
         * panel lays out in zoomed ones, so the gap is divided by the zoom.
         * In the desktop app the variable is unset and it divides by one.
         *
         * On a narrow window the rail goes above the page as one row.
         */
        className="flex h-[40rem] max-h-[calc(var(--radix-popover-content-available-height)/var(--mail-css-zoom,1))] w-[54rem] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0 md:flex-row"
        collisionPadding={12}
        onCloseAutoFocus={(e) => e.preventDefault()}
        /*
          A menu this panel opened is not somewhere else.

          The mark menu hangs on <body> so it can escape this panel's
          scroll, which to Radix looks like a press outside — so the panel
          closed on the way down and the click never reached the item it
          was aimed at. Nothing here was clickable at all.
        */
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-mail-mark-menu]")) event.preventDefault();
        }}
      >
        <nav
          aria-label={t("settings")}
          className="flex shrink-0 flex-col gap-2 border-b border-stone-200 bg-[var(--mail-chrome)] p-3 md:w-52 md:border-b-0 md:border-r"
        >
          <div className="flex items-baseline justify-between gap-2 px-1.5 md:block md:pt-1">
            <h2 className="font-serif text-xl font-bold text-stone-900">
              {t("settings")}
            </h2>
            {MAIL_APP_VERSION ? (
              <p className="text-xs text-stone-400">
                {t("version")} {MAIL_APP_VERSION}
              </p>
            ) : null}
          </div>
          <label className="relative flex items-center md:mt-1">
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-stone-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settingsSearch")}
              aria-label={t("settingsSearch")}
              className="h-8 w-full rounded-lg border border-stone-200 bg-white pl-8 pr-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </label>
          <ul className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-0.5 md:flex-col md:overflow-visible">
            {matches.map(({ id, label, Icon, count }) => {
              const selected = id === shown;
              return (
                <li key={id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={selected ? "page" : undefined}
                    onClick={() => setCategory(id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      selected
                        ? "bg-white font-semibold text-stone-900 shadow-sm"
                        : "text-stone-700 hover:bg-stone-200/50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        selected ? "bg-teal-700 text-white" : "bg-stone-200/70 text-stone-500"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {count ? (
                      <span className="text-xs tabular-nums text-stone-400">{count}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {matches.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-stone-400">{t("settingsNoMatch")}</li>
            ) : null}
          </ul>
        </nav>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">{pane}</section>
      </MailPopoverContent>
    </Popover>
  );
}

