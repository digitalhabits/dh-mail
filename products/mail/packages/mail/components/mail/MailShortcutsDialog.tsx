"use client";

/**
 * Changing the thread shortcuts.
 *
 * Click a binding, press the keys, and it is stored. A press is read from the
 * event rather than typed as text, so what the reader presses is what gets
 * saved — including whatever their keyboard layout puts on that key.
 *
 * The panel refuses a binding the operating system answers first, because
 * storing one would look like it worked and then never fire.
 */

import * as React from "react";
import {
  Archive,
  FolderInput,
  Forward,
  Maximize2,
  MessagesSquare,
  PictureInPicture2,
  Pin,
  Printer,
  Reply,
  ReplyAll,
  RotateCwFadingClock,
  SendHorizontal,
  Trash2,
} from "lucide-react";

import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { ShortcutKeys } from "@/components/mail/shortcut-keys";
import {
  SettingsGroup,
  SettingsHeading,
  SettingsPane,
  SettingsRow,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import {
  conflictingActions,
  DEFAULT_MAIL_SHORTCUTS,
  formatShortcut,
  MAIL_SHORTCUT_GROUPS,
  MAIL_SHORTCUT_LABELS,
  reservedReason,
  resetMailShortcuts,
  sameShortcut,
  setMailShortcut,
  type MailShortcut,
  type MailShortcutAction,
} from "@/lib/mail/shortcuts";
import { useMailT } from "@/lib/mail/i18n";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { cn } from "@/lib/utils";

/** Keys that only ever accompany another one. */
const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control"]);

/** The same glyph the toolbar uses for this action, when it has one. */
const SHORTCUT_ICONS: Partial<
  Record<MailShortcutAction, React.ComponentType<{ className?: string }>>
> = {
  reply: Reply,
  replyAll: ReplyAll,
  forward: Forward,
  send: SendHorizontal,
  snooze: RotateCwFadingClock,
  archive: Archive,
  delete: Trash2,
  toggleUnread: MailDotIcon,
  moveToFolder: FolderInput,
  togglePin: Pin,
  expandList: Maximize2,
  popOut: MessagesSquare,
  floatMessage: PictureInPicture2,
  focusThread: Maximize2,
  focusMessage: Maximize2,
  print: Printer,
};

/**
 * The shortcut list, for the settings popover.
 *
 * It used to be a second dialog in the middle of the window. Same surface,
 * different place, so the panel looked as if it had jumped. The list did
 * not need a new place — only a new panel in the same popover.
 */
export function MailShortcutsPanel({ onDone }: { onDone: () => void }) {
  const t = useMailT();
  const shortcuts = useMailShortcuts();
  const [capturing, setCapturing] = React.useState<MailShortcutAction | null>(
    null
  );
  const [refused, setRefused] = React.useState<string | null>(null);
  const clashing = conflictingActions(shortcuts);

  React.useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        setRefused(null);
        return;
      }
      // Wait for the key the modifiers belong to.
      if (MODIFIER_KEYS.has(event.key)) return;

      const next: MailShortcut = {
        key: event.key.toLowerCase(),
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      };
      const reserved = reservedReason(next);
      if (reserved) {
        setRefused(`${formatShortcut(next)} — ${t(reserved)}.`);
        return;
      }
      setMailShortcut(capturing, next);
      setCapturing(null);
      setRefused(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, t]);

  return (
    <SettingsPane
      title={t("keyboardShortcuts")}
      description={t("settingsShortcutsHint")}
      onDone={onDone}
      footerStart={
        // Reset all sits away from Done, on the left, because the two are
        // not a pair — one undoes every binding on the list.
        <button
          type="button"
          className={settingsSecondaryButton}
          onClick={() => {
            resetMailShortcuts();
            setCapturing(null);
            setRefused(null);
          }}
        >
          {t("resetAll")}
        </button>
      }
    >
        {/* A gap between groups, not first-child margin. Each heading is
            first in its own wrapper, so first:mt-0 would eat the space
            above Triage and View. */}
        <div className="flex flex-col gap-6">
        {MAIL_SHORTCUT_GROUPS.map((group) => (
          <div key={group.label}>
            <SettingsHeading>{t(group.label)}</SettingsHeading>
            <SettingsGroup>
              {group.actions.map((action) => {
                const shortcut = shortcuts[action];
                const isDefault = sameShortcut(
                  shortcut,
                  DEFAULT_MAIL_SHORTCUTS[action]
                );
                const Icon = SHORTCUT_ICONS[action];
                return (
                  <SettingsRow
                    key={action}
                    label={
                      <span className="flex items-center gap-2">
                        {Icon ? (
                          <Icon
                            className="h-4 w-4 shrink-0 text-stone-400"
                            aria-hidden
                          />
                        ) : null}
                        {t(MAIL_SHORTCUT_LABELS[action])}
                      </span>
                    }
                    control={
                      <span className="flex shrink-0 items-center gap-2">
                        {!isDefault ? (
                          <button
                            type="button"
                            className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-800"
                            onClick={() => setMailShortcut(action, null)}
                          >
                            {t("reset")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setRefused(null);
                            setCapturing(action);
                          }}
                          className={cn(
                            // Not a monospace face: it is the one font on a Mac
                            // that does not carry every modifier glyph, and the
                            // ones it borrows come back the wrong size.
                            "inline-flex min-w-[86px] items-center justify-center rounded-md border px-2.5 py-1 text-center text-sm font-medium transition-colors",
                            capturing === action
                              ? "border-teal-600 bg-teal-50 text-teal-800"
                              : clashing.has(action)
                                ? "border-red-300 bg-red-50 text-red-600"
                                : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                          )}
                        >
                          {capturing === action ? (
                            <span className="font-normal">{t("pressKeys")}</span>
                          ) : (
                            <ShortcutKeys shortcut={shortcut} />
                          )}
                        </button>
                      </span>
                    }
                  />
                );
              })}
            </SettingsGroup>
          </div>
        ))}
        </div>

        {refused ? (
          <p className="mt-2 text-sm text-red-600">{refused}</p>
        ) : null}
        {clashing.size ? (
          <p className="mt-2 text-sm text-red-600">{t("shortcutClash")}</p>
        ) : null}
    </SettingsPane>
  );
}
