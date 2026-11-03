"use client";

import { Button } from "@/components/ui/button";
import { openDiagnostics } from "@/components/mail/DiagnosticsDialog";
import * as React from "react";
import { createPortal } from "react-dom";
import { useMailColorMode, useMailTheme, type MailTheme } from "@/lib/mail/theme";
import { MailAccountsPanel } from "@/components/mail/MailAccountsPanel";
import { ExchangeSettingsPane, useExchangeConnectRequest } from "@/components/mail/ExchangeConnectForm";
import { useLoadImagesByDefault } from "@/components/mail/MailBubble";
import { useMailListPlacement } from "@/components/mail/use-mail-layout";
import { ChevronDown, ChevronLeft, RefreshCw, Settings } from "lucide-react";
import { beginNativeWindowDragOnMove, openExternalUrl } from "@/lib/native-shell";
import { type AutoReplyDto } from "@/components/mail/AutoReplyDialog";
import { ContactSourcesPanel } from "@/components/mail/ContactSourcesDialog";
import { setMailListPlacement, type MailListPlacement } from "@/lib/mail/layout";
import { MailShortcutsPanel } from "@/components/mail/MailShortcutsDialog";
import { SnoozeOptionsPanel } from "@/components/mail/SnoozeOptionsPanel";
import { readUsagePingEnabled, writeUsagePingEnabled } from "@/lib/mail/usage-ping";
import { useShowFolderCounts, writeShowFolderCounts } from "@/lib/mail/folder-counts-setting";
import { SettingsGroup, SettingsLanguageRow, SettingsPane, SettingsTextSizeRow, SettingsRow, SettingsToggle } from "@/components/mail/settings-ui";
import { ReaderLinesSetting } from "@/components/mail/reader-lines-setting";
import { TeamReadingSettings } from "@/components/mail/team-layer";
import { DraftsFolderSetting } from "@/components/mail/drafts-folder-setting";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { useSettingsPage } from "@/components/mail/use-settings-page";
import { OPEN_MAIL_ACCOUNTS_EVENT, isMailSettingsCategory, type MailSettingsCategory } from "@/lib/mail/open-mail-accounts-menu";
import { MAILBOX_CONNECTED_EVENT } from "@/lib/mail/mailbox-connected";
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
        "rounded-inner p-1.5",
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

/** What the Settings menu takes. */
export type MailLayoutMenuProps = {
  /** Trigger sits on the navy list chrome. */
  onNavy?: boolean;
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
};

/** Where "Open an issue" goes, under the sidebar. */
const MAIL_ISSUES_URL = "https://github.com/digitalhabits/dh-mail/issues";
const MAIL_TEAM_EMAIL = "team@digitalhabits.org";

/**
 * The Settings button, and Settings as a page.
 *
 * Settings is laid out as To-Do lays out its own (TodoSettingsModal): one
 * page over the whole window, with "‹ Settings" at the top to go back.
 * Every section is on one scroll. Wide enough, a sidebar beside it lists the
 * sections, and marks the one being read. The feedback line and the version
 * stand at the sidebar's foot. Narrower, there is no sidebar, and the foot
 * comes after the last section.
 */
export function MailLayoutMenu({
  onNavy = false,
  knownEmails,
  onVisibilityChange,
  onAccountsChanged,
  autoReplies,
  onSetUpAutoReply,
  onEndAutoReply,
  ownIdentity,
  onOwnIdentityChange,
}: MailLayoutMenuProps) {
  const { close, exchange, loadImagesByDefault, open, placement, sections, setLoadImagesByDefault, setOpen, setTheme, setUsagePing, showFolderCounts, t, target, theme, usagePing } = useSettingsMenuState();
  const { pageRef, scrollRef, wide, current: currentSection, goTo } = useSettingsPage(
    sections.map((s) => s.id),
    close,
    open
  );
  const colorMode = useMailColorMode();

  // Opened on one section (the mailbox filter, a dialog that goes back):
  // the page starts there.
  React.useLayoutEffect(() => {
    if (open && target) goTo(target.id, false);
  }, [open, target, goTo]);

  const panes: Record<MailSettingsCategory, React.ReactNode> = {
    accounts: exchange.request ? (
      <ExchangeSettingsPane request={exchange.request} onClose={exchange.clear} />
    ) : (
      <SettingsPane title={t("accounts")} description={t("settingsAccountsHint")}>
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
    ),
    general: (
      <SettingsPane title={t("general")} description={t("settingsGeneralHint")}>
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
                  className="cursor-pointer appearance-none rounded-inner border border-stone-200 bg-white py-1 pl-2.5 pr-7 text-xs text-stone-700 outline-none hover:bg-stone-50"
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
          {/* Only where the count can run: a Mac or Windows release build,
              where apps/mail/src/usage-ping.ts sets the flag. */}
          {(window as unknown as { __MAIL_USAGE_PING__?: string }).__MAIL_USAGE_PING__ ? (
            <SettingsRow
              label={t("sendUsageCount")}
              hint={t("sendUsageCountHint")}
              control={
                <SettingsToggle
                  checked={usagePing}
                  onChange={(enabled) => {
                    setUsagePing(enabled);
                    writeUsagePingEnabled(enabled);
                  }}
                  label={t("sendUsageCount")}
                />
              }
            />
          ) : null}
        </SettingsGroup>
      </SettingsPane>
    ),
    reading: (
      <SettingsPane title={t("settingsReading")} description={t("settingsReadingHint")}>
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
                        "rounded-inner p-1 transition-colors",
                        selected ? "bg-teal-50" : "hover:bg-stone-100"
                      )}
                    >
                      <MailListLayoutDiagram diagram={option.diagram} selected={selected} />
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
          <ReaderLinesSetting />
          <SettingsRow
            label={t("showFolderCounts")}
            hint={t("showFolderCountsHint")}
            control={
              <SettingsToggle
                checked={showFolderCounts}
                onChange={writeShowFolderCounts}
                label={t("showFolderCounts")}
              />
            }
          />
          <TeamReadingSettings />
        </SettingsGroup>
      </SettingsPane>
    ),
    snooze: <SnoozeOptionsPanel />,
    contacts: <ContactSourcesPanel />,
    shortcuts: <MailShortcutsPanel />,
    advanced: (
      <SettingsPane title={t("settingsAdvanced")} description={t("settingsAdvancedHint")}>
        <SettingsGroup>
          <DraftsFolderSetting />
        </SettingsGroup>
        {/* Here as well as in the Help menu: Windows has no Help menu. */}
        <SettingsGroup>
          <SettingsRow
            label={t("diagnosticsTitleShort")}
            hint={t("diagnosticsMenuHint")}
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  close();
                  openDiagnostics();
                }}
              >
                {t("diagnosticsMenu")}
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsPane>
    ),
  };

  const foot = (
    <div className="flex flex-col gap-3 text-[13px] leading-normal text-stone-500">
      <p>
        {t("settingsFeedback")}{" "}
        <a
          href={MAIL_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-700 underline underline-offset-2"
          onClick={(e) => {
            // The desktop app opens a link in the browser through the shell.
            e.preventDefault();
            void openExternalUrl(MAIL_ISSUES_URL).then((opened) => {
              if (!opened) window.open(MAIL_ISSUES_URL, "_blank", "noopener,noreferrer");
            });
          }}
        >
          {t("settingsOpenIssue")}
        </a>{" "}
        {t("settingsOrEmail")}{" "}
        <a
          href={`mailto:${MAIL_TEAM_EMAIL}`}
          className="text-teal-700 underline underline-offset-2"
        >
          {MAIL_TEAM_EMAIL}
        </a>
      </p>
      {MAIL_APP_VERSION ? (
        <p>
          {t("version")} {MAIL_APP_VERSION}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <button
        type="button"
        title={t("settings")}
        aria-label={t("settings")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "rounded-inner p-1.5",
          onNavy
            ? open
              ? "bg-white/15 text-white"
              : "text-white/70 hover:bg-white/10 hover:text-white"
            : open
              ? "bg-stone-200/70 text-stone-900"
              : "text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
        )}
        onPointerDown={beginNativeWindowDragOnMove}
        onClick={() => setOpen(!open)}
      >
        {/* A cog: the sign for settings that people already know. A
            step larger than the row's 14px marks: at the end of the row
            it is the one control drawn with no word. */}
        <Settings className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={pageRef}
              role="dialog"
              aria-label={t("settings")}
              // The shell's colours, which a portal leaves behind: as
              // SettingsDialog. Under the dialogs (z-50) that the page opens.
              data-theme={colorMode}
              className={cn(
                "mail-shell mail-settings-page fixed inset-0 z-[45] flex flex-col bg-[var(--mail-chrome)] text-stone-800",
                wide && "is-wide"
              )}
            >
              {/* Where the window's title bar is: its empty part moves the
                  window, and it keeps clear of the Mac's traffic lights. */}
              <div
                data-tauri-drag-region="deep"
                className="mail-reader-topbar flex h-12 shrink-0 items-center border-b border-stone-200 pr-4"
              >
                {/* The chevron and the word are one button: a press on
                    "Settings" goes back too. */}
                <button
                  type="button"
                  aria-label={t("back")}
                  onClick={close}
                  className="flex h-[34px] min-w-0 items-center gap-1.5 rounded-control pl-1.5 pr-2.5 text-stone-900 hover:bg-stone-200/50"
                >
                  <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="truncate font-serif text-[1.35rem] font-medium leading-tight">
                    {t("settings")}
                  </span>
                </button>
              </div>
              <div className="flex min-h-0 flex-1">
                {wide ? (
                  <nav
                    aria-label={t("settings")}
                    className="flex w-[210px] shrink-0 flex-col justify-between gap-6 overflow-y-auto border-r border-stone-200 px-2 pb-4 pt-5"
                  >
                    <div className="flex flex-col gap-0.5">
                      {sections.map(({ id, label }) => {
                        const current = currentSection === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-current={current ? "true" : undefined}
                            onClick={() => goTo(id)}
                            className={cn(
                              "w-full rounded-control border px-3 py-2 text-left text-base transition-colors",
                              // The open section: a white pill with a fine
                              // line round it, as the cards (mockups, 2026-11-03).
                              current
                                ? "border-stone-200 bg-white font-semibold text-stone-900 shadow-sm"
                                : "border-transparent text-stone-600 hover:bg-stone-200/50 hover:text-stone-900"
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="px-3">{foot}</div>
                  </nav>
                ) : null}
                <div
                  ref={scrollRef}
                  className={cn(
                    "min-w-0 flex-1 overflow-y-auto overscroll-contain",
                    wide ? "px-10 pb-12 pt-7" : "px-[18px] pb-8 pt-5"
                  )}
                >
                  {/* A fine line between sections, and air either side of it. */}
                  <div className="flex max-w-[760px] flex-col divide-y divide-stone-200">
                    {sections.map(({ id }) => (
                      <section key={id} data-settings-section={id} className="py-11 first:pt-0">
                        {panes[id]}
                      </section>
                    ))}
                    {/* Narrow: no sidebar, so its foot comes at the end. */}
                    {wide ? null : foot}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/** The Settings page's state: open, the sections, the section to start on, the settings it reads, and connecting Exchange. */
export function useSettingsMenuState() {
  const [open, setOpenState] = React.useState(false);
  /**
   * The section to start on, when Settings was opened on one. A new object
   * each time, so a second request for the same section goes there again.
   */
  const [target, setTarget] = React.useState<{ id: MailSettingsCategory } | null>(null);
  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setTarget(null);
  }, []);
  const placement = useMailListPlacement();
  const [loadImagesByDefault, setLoadImagesByDefault] =
    useLoadImagesByDefault();
  const [theme, setTheme] = useMailTheme();
  const [usagePing, setUsagePing] = React.useState(readUsagePingEnabled);
  const showFolderCounts = useShowFolderCounts();
  const hasDesktopShell =
    typeof window !== "undefined" && Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
  const t = useMailT();
  /*
    The Exchange connect form is the Accounts section of Settings, not a
    dialog over it. A request opens Settings at Accounts, and the Accounts
    section shows the form until it is answered.
  */
  const exchange = useExchangeConnectRequest(() => {
    setTarget({ id: "accounts" });
    setOpenState(true);
  });
  const cancelExchange = exchange.cancel;
  // Settings shut with the form open: the answer is "no".
  React.useEffect(() => {
    if (!open) cancelExchange();
  }, [open, cancelExchange]);
  // Opened from the mailbox filter next to search, the app menu, or a dialog
  // that goes back to one section. One page is mounted, so this cannot open
  // two at once.
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const wanted =
        event instanceof CustomEvent
          ? (event.detail as { category?: unknown } | null)?.category
          : undefined;
      setTarget(isMailSettingsCategory(wanted) ? { id: wanted } : null);
      setOpenState(true);
    };
    window.addEventListener(OPEN_MAIL_ACCOUNTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MAIL_ACCOUNTS_EVENT, onOpen);
  }, []);
  /*
    A new mailbox asks how it should fit the week (AccountRhythmDialog), and
    Settings, where it was connected, goes out of its way, so that the
    question is the one thing on the screen.
  */
  React.useEffect(() => {
    const onConnected = () => setOpen(false);
    window.addEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
    return () => window.removeEventListener(MAILBOX_CONNECTED_EVENT, onConnected);
  }, [setOpen]);
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  /** The sections, in the order the page shows them. */
  const sections: { id: MailSettingsCategory; label: string }[] = [
    // General first, then the accounts (Ulrik, 2026-11-03).
    { id: "general", label: t("general") },
    { id: "accounts", label: t("accounts") },
    { id: "reading", label: t("settingsReading") },
    { id: "snooze", label: t("settingsSnoozeSchedule") },
    { id: "contacts", label: t("settingsContacts") },
    { id: "shortcuts", label: t("keyboardShortcuts") },
    // Only in the desktop app: the drafts folder is a folder on this Mac.
    ...(hasDesktopShell ? [{ id: "advanced" as const, label: t("settingsAdvanced") }] : []),
  ];
  return { close, exchange, loadImagesByDefault, open, placement, sections, setLoadImagesByDefault, setOpen, setTheme, setUsagePing, showFolderCounts, t, target, theme, usagePing };
}
