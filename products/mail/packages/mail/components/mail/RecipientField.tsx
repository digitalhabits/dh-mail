"use client";

import * as React from "react";
import { Clock, Users, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { openContactSourcesDialog } from "@/components/mail/ContactSourcesDialog";
import { AppleMark } from "@/components/mail/AccountMark";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { emailsOfRecipients, recipientKey, type MailRecipient } from "@/lib/mail/contact-list-types";
import { contactSourceBadge, historyEmailedWhen } from "@/lib/mail/contact-suggestion";
import {
  chipSelectionAfterRemoval,
  recipientsToClipboardText,
} from "@/lib/mail/recipient-chips";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { TypingLine } from "@/components/mail/recipient-typing-line";
import { cn } from "@/lib/utils";
import { type ContactSuggestion, HIGHLIGHT_ROW, avatarTone, formatSearchingFooter, initials, nameForEmail, parseEmails, provenanceBadgeClass } from "@/components/mail/recipient-suggestions";
import {
  EditListButton,
  ListChip,
  ListEditorCard,
  ListsMenu,
  SaveAsListControl,
  listSubtitle,
} from "@/components/mail/recipient-lists";
import { RecipientCarryProvider } from "@/components/mail/recipient-carry";
import { useRecipientSources, useRecipientMenu, useChipSelection, useRecipientCommit, useRecipientLayout } from "@/components/mail/use-recipient-field";


export { RecipientCarryProvider };

/**
 * One person in a field, and who they actually are.
 *
 * The chip says the name when it has one, which is what you want while
 * writing and no help at all when you are checking. Two people share a
 * first name, an old address for the right person is still the wrong
 * address, and a name typed by a sender is not a name anybody verified.
 * Double-click and the chip says the address instead — with where the name
 * came from, and a way to take a copy.
 *
 * Double-click rather than a click or a hover: a click selects the chip
 * (that is how several are cut or deleted at once), and a tooltip cannot
 * be copied from, which is most of the reason for looking.
 */
function EmailChip({
  recipient,
  contacts,
  variant,
  selected,
  onSelect,
  onRelease,
  onRemove,
  carry,
}: {
  recipient: Extract<MailRecipient, { kind: "email" }>;
  contacts: ContactSuggestion[];
  variant: "boxed" | "inline";
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  /** The mouse let go without a drag: give the input its focus back. */
  onRelease?: () => void;
  onRemove: () => void;
  /** Set where the chip may be carried to another field. */
  carry?: React.HTMLAttributes<HTMLElement>;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const label = recipient.name || recipient.email;
  const known = contacts.find(
    (c) => c.email.trim().toLowerCase() === recipient.email.trim().toLowerCase()
  );
  const badge = known ? contactSourceBadge(known, t) : null;

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          {...carry}
          className={cn(
            "inline-flex cursor-pointer select-none items-center gap-1 rounded-full bg-[var(--mail-chip)] py-0.5 pl-2 pr-1 text-[var(--mail-chip-fg)]",
            variant === "inline"
              ? "text-[13px]"
              : // Block flow in a boxed field, so the spacing a flex gap
                // gave is carried by the chips themselves.
                "mb-1 mr-1.5 align-middle text-xs",
            selected && "ring-2 ring-teal-600 ring-offset-1"
          )}
          title={recipient.name ? recipient.email : undefined}
          aria-selected={selected}
          /* Focusable, so the mouse going down on it moves focus here and
             not out of the field: the input's blur then does nothing, and
             the mouse coming up hands focus back. If the default is
             cancelled instead, the focus stays but WebKit cannot start a
             drag. Then a chip can be selected but never carried to another
             field. */
          tabIndex={-1}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onSelect(e);
          }}
          onMouseUp={(e) => {
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            onRelease?.();
          }}
          /* A click selects; the card is for a double-click. The trigger
             would open it on the click as well, and the card takes the
             focus with it. Then a chip picked with the mouse cannot be
             cut or copied, because the keys go to the card. Marking the click
             handled is what tells the trigger to leave it. */
          onClick={(e) => e.preventDefault()}
          onDoubleClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          onContextMenu={(e) =>
            openAddressMenu(e, recipient.email, recipient.name)
          }
        >
          {label}
          <button
            type="button"
            data-chip-remove
            aria-label={t("removeNamed", { name: label })}
            title={t("removeNamed", { name: label })}
            className="rounded-full px-1 text-[var(--mail-chip-muted)] hover:text-red-500"
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </PopoverTrigger>
      <MailPopoverContent align="start" className="w-72 p-3">
        {recipient.name ? (
          <p className="text-sm font-semibold text-stone-900">
            {recipient.name}
          </p>
        ) : null}
        {/* Selectable, and wrapped rather than cut: an address you cannot
            read the end of is the one thing this panel is for. */}
        <p className="mt-0.5 select-text break-all text-sm text-stone-700">
          {recipient.email}
        </p>
        {badge ? (
          <span
            className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              provenanceBadgeClass(known!.source)
            )}
          >
            {known!.source === "mac" ? <AppleMark /> : null}
            {badge}
          </span>
        ) : null}
        <div className="mt-3 flex items-center gap-3 border-t border-stone-100 pt-2.5">
          <button
            type="button"
            className="text-sm text-teal-700 hover:underline"
            onClick={() => {
              void copyTextToClipboard(recipient.email).then((ok) =>
                ok
                  ? toast.success(mailSay("copied"))
                  : toast.error(mailSay("couldNotCopy"))
              );
            }}
          >
            {t("copyAddress")}
          </button>
          <button
            type="button"
            className="text-sm text-stone-500 hover:text-red-700"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {t("remove")}
          </button>
        </div>
      </MailPopoverContent>
    </Popover>
    {addressMenu}
    </>
  );
}

/** What a recipient field takes. */
export type RecipientFieldProps = {
  label: string;
  values: MailRecipient[];
  onChange: (next: MailRecipient[]) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  variant?: "boxed" | "inline";
  className?: string;
  /** Show “Save as list…” when there are 2+ individual people chips. */
  allowSaveList?: boolean;
  /**
   * Controls that belong beside the field — Cc and Bcc, from the composer.
   * Under “Save as list…” rather than next to it, so the column reads down.
   */
  actions?: React.ReactNode;
  /**
   * Show at most this many chips while nobody is writing in the field.
   *
   * A circular to thirty people filled the window with addresses and pushed
   * the message itself off the bottom. Past this count the rest are folded
   * into “and N more”, which unfolds on a click and whenever the field is
   * being typed in — you cannot edit what you cannot see.
   */
  collapseAfter?: number;
  /**
   * Connected mailboxes to always suggest (email yourself). Passed from the
   * shell so To/Cc works even before /api/mail/contacts has synced.
   */
  ownAccounts?: string[];
  /**
   * Where Tab goes when this field has nothing left to do with it.
   *
   * Tab still finishes what is being typed first — it takes the highlighted
   * suggestion, or turns a typed address into a chip. Only once the box is
   * empty does it leave, and then it should land on the next thing the writer
   * means to fill in, not on the buttons that happen to sit beside this one.
   */
  onTabOut?: () => void;
  /** The sender: an Exchange mailbox's directory is asked as the reader types. */
  directoryAccount?: string;
};

/** Editable To/Cc/Bcc field with contacts + saved contact lists. */
export function RecipientField({
  label,
  values,
  onChange,
  placeholder,
  inputRef,
  variant = "boxed",
  className,
  allowSaveList = false,
  actions,
  collapseAfter,
  ownAccounts,
  onTabOut,
  directoryAccount,
}: RecipientFieldProps) {
  const { contacts, directory, draft, highlight, keyMovedRef, lists, menuRef, setContacts, setDraft, setHighlight, setSourceSummaries, sourceSummaries, t } = useRecipientSources({ directoryAccount });
  const { blurTimerRef, chipNavRef, fieldElRef, hideHistory, inputElRef, menu, selected, setAnchor, setFocusIndex, setInputRef, setMenuOpen, setSelected, setUnfolded, setWriting, showMenu, unfolded, writing } = useRecipientMenu({ contacts, directory, draft, inputRef, lists, ownAccounts, setContacts, setHighlight, setSourceSummaries, t, values });
  const { cancelBlurTimer, clearChipSelection, focusDraftInput, handleChipArrowKey, handleChipSelect, removeSelectedChips, selectAllChips, selectOnly } = useChipSelection({ blurTimerRef, chipNavRef, draft, inputElRef, onChange, setAnchor, setFocusIndex, setMenuOpen, setSelected, values });
  const { commitDraft, contactItems, editingList, emailPeople, listItems, menuBox, openListEditor, pickItem, setEditingList, showSaveList } = useRecipientCommit({ allowSaveList, cancelBlurTimer, clearChipSelection, contacts, fieldElRef, lists, menu, onChange, setDraft, setMenuOpen, showMenu, values });
  const { carryProps, drop, foldedCount, folding, layout, shownValues } = useRecipientLayout({ clearChipSelection, collapseAfter, onChange, unfolded, values, variant, writing });

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 flex-wrap items-start gap-1.5",
        className
      )}
      /* On the whole field, not on the box inside it: a chip is let go
         over the row it is meant for, and the gaps between the chips are
         as much a part of that row as the chips are. */
      {...drop.dropProps}
    >
      <div
        ref={fieldElRef}
        className={cn(
          "relative min-w-0 flex-1",
          /* Lit while somebody is being carried over it, so it is plain
             which field they will land in — and read from the carry as
             well as from the pointer, so a drag abandoned outside the
             window does not leave a field lit for a drop that is not
             coming. */
          drop.over && "rounded-control ring-2 ring-teal-500/60",
          /* Block rather than flex when the field has a box round it, so
             "Save as list…" can float into its top right corner: the chips
             wrap around it on the first line and take the whole width
             below. As a flex item it could only be a column of its own,
             beside the box, which cost more room than the addresses. */
          variant === "boxed"
            ? layout.box
            : "flex flex-wrap items-center gap-1.5",
          /*
            While the suggestions are open, the box and the list are one
            shape: the side where they meet goes square on both, and the
            list starts on the box's own border. A list that floated a few
            pixels off, under round corners, read as a second thing on the
            page and not as what the box is offering.
          */
          variant === "boxed" &&
            showMenu &&
            !editingList &&
            (menuBox.above ? "rounded-t-none" : "rounded-b-none")
        )}
        onMouseDown={(e) => {
          // Clicking empty padding in the field should keep/restore input focus
          // without clearing an existing chip selection.
          if (e.target === e.currentTarget) {
            focusDraftInput();
          }
        }}
      >
        {variant === "boxed" && showSaveList ? (
          <SaveAsListControl
            className="float-right ml-2 mb-1"
            people={emailPeople}
            contacts={contacts}
            onSaved={() => {
              /* recipients stay; list is available next typeahead */
            }}
          />
        ) : null}
        {variant === "boxed" && label ? (
          <span
            className={layout.label}
          >
            {label}
          </span>
        ) : null}
        <RecipientChips carryProps={carryProps} clearChipSelection={clearChipSelection} contacts={contacts} focusDraftInput={focusDraftInput} handleChipSelect={handleChipSelect} onChange={onChange} selected={selected} shownValues={shownValues} values={values} variant={variant} />
        {folding ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[13px] font-medium text-teal-700 hover:underline",
              variant === "boxed" && "mb-1 align-middle"
            )}
            onClick={() => {
              setUnfolded(true);
              focusDraftInput();
            }}
          >
            {t("andMoreCount", { count: foldedCount })}
          </button>
        ) : null}
        {/* One line for the box and the lists button: see TypingLine. */}
        <TypingLine inline={variant === "inline"}>
        <RecipientInput blurTimerRef={blurTimerRef} cancelBlurTimer={cancelBlurTimer} chipNavRef={chipNavRef} clearChipSelection={clearChipSelection} commitDraft={commitDraft} draft={draft} fieldElRef={fieldElRef} folding={folding} handleChipArrowKey={handleChipArrowKey} highlight={highlight} keyMovedRef={keyMovedRef} layout={layout} menu={menu} onChange={onChange} onTabOut={onTabOut} pickItem={pickItem} placeholder={placeholder} removeSelectedChips={removeSelectedChips} selectAllChips={selectAllChips} selectOnly={selectOnly} setDraft={setDraft} setHighlight={setHighlight} setInputRef={setInputRef} setMenuOpen={setMenuOpen} setUnfolded={setUnfolded} setWriting={setWriting} showMenu={showMenu} values={values} variant={variant} />
        {lists.length ? (
          <ListsMenu
            lists={lists}
            onPick={(list) => pickItem({ kind: "list", list })}
            onEdit={openListEditor}
            /* The far right of the field, whichever way the field is laid
               out. `ml-auto` reaches it in the inline variant, which is a
               flex row; a boxed field is block flow, where the only way to
               the right edge is to float — the same way "Save as list…"
               gets to the corner above it. */
            className={layout.lists}
          />
        ) : null}
        </TypingLine>
        {editingList ? (
          <ListEditorCard
            list={editingList}
            contacts={contacts}
            above={menuBox.above}
            /*
              Taller than the suggestions are allowed to be. A name, the
              people, a box to add one and two buttons come to a little
              over their 288 — at which the row holding "Done" fell below
              the fold of a panel nobody expected to scroll.
            */
            maxHeight={Math.min(440, menuBox.room)}
            onClose={() => setEditingList(null)}
            onSaved={(saved) => {
              // A list already in this message follows the edit.
              onChange(
                values.map((v) =>
                  v.kind === "list" && v.listId === saved.id
                    ? { ...v, name: saved.name, members: saved.members }
                    : v
                )
              );
            }}
            onDeleted={(listId) => {
              onChange(
                values.filter((v) => !(v.kind === "list" && v.listId === listId))
              );
            }}
          />
        ) : null}
        <RecipientSuggestions contactItems={contactItems} editingList={editingList} hideHistory={hideHistory} highlight={highlight} listItems={listItems} menu={menu} menuBox={menuBox} menuRef={menuRef} openListEditor={openListEditor} pickItem={pickItem} setHighlight={setHighlight} setMenuOpen={setMenuOpen} showMenu={showMenu} sourceSummaries={sourceSummaries} t={t} variant={variant} />
      </div>
      {(showSaveList && variant !== "boxed") || actions ? (
        /* A column, not a row: "Save as list…" is a thing you do to the
           addresses above it, and Cc/Bcc are two more fields to open. Side
           by side they read as three of a kind. */
        <span className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
          {showSaveList && variant !== "boxed" ? (
            <SaveAsListControl
              className="text-[15px] font-medium"
              people={emailPeople}
              contacts={contacts}
              onSaved={() => {
                /* recipients stay; list is available next typeahead */
              }}
            />
          ) : null}
          {actions}
        </span>
      ) : null}
    </div>
  );
}

/** The chips, folded after `collapseAfter` when the field is not being written in. */
function RecipientChips({
  carryProps,
  clearChipSelection,
  contacts,
  focusDraftInput,
  handleChipSelect,
  onChange,
  selected,
  shownValues,
  values,
  variant,
}: {
  carryProps: ReturnType<typeof useRecipientLayout>["carryProps"];
  clearChipSelection: ReturnType<typeof useChipSelection>["clearChipSelection"];
  contacts: ReturnType<typeof useRecipientSources>["contacts"];
  focusDraftInput: ReturnType<typeof useChipSelection>["focusDraftInput"];
  handleChipSelect: ReturnType<typeof useChipSelection>["handleChipSelect"];
  onChange: RecipientFieldProps["onChange"];
  selected: ReturnType<typeof useRecipientMenu>["selected"];
  shownValues: ReturnType<typeof useRecipientLayout>["shownValues"];
  values: RecipientFieldProps["values"];
  variant: Exclude<RecipientFieldProps["variant"], undefined>;
}) {
  return (
    <>{shownValues.map((value, index) => {
          const isSelected = selected.has(index);
          if (value.kind === "list") {
            return (
              <ListChip
                key={recipientKey(value)}
                recipient={value}
                contacts={contacts}
                variant={variant}
                carry={carryProps(value)}
                selected={isSelected}
                onSelect={(e) => handleChipSelect(index, e)}
                onRelease={focusDraftInput}
                onChange={(next) => {
                  const copy = [...values];
                  copy[index] = next;
                  onChange(copy);
                }}
                onExpand={() => {
                  clearChipSelection();
                  const others = values.filter((_, i) => i !== index);
                  const taken = new Set(emailsOfRecipients(others));
                  const expanded: MailRecipient[] = [...others];
                  for (const m of value.members) {
                    const e = m.email.toLowerCase();
                    if (taken.has(e)) continue;
                    taken.add(e);
                    expanded.push({
                      kind: "email",
                      email: e,
                      name: m.name || nameForEmail(e, contacts),
                    });
                  }
                  onChange(expanded);
                }}
                onRemove={() => {
                  clearChipSelection();
                  onChange(values.filter((_, i) => i !== index));
                }}
              />
            );
          }
          return (
            <EmailChip
              key={recipientKey(value)}
              recipient={value}
              contacts={contacts}
              variant={variant}
              carry={carryProps(value)}
              selected={isSelected}
              onSelect={(e) => handleChipSelect(index, e)}
              onRelease={focusDraftInput}
              onRemove={() => {
                clearChipSelection();
                onChange(values.filter((_, i) => i !== index));
              }}
            />
          );
        })}</>
  );
}

/** The input that new recipients are typed into, and its keys. */
function RecipientInput({
  blurTimerRef,
  cancelBlurTimer,
  chipNavRef,
  clearChipSelection,
  commitDraft,
  draft,
  fieldElRef,
  folding,
  handleChipArrowKey,
  highlight,
  keyMovedRef,
  layout,
  menu,
  onChange,
  onTabOut,
  pickItem,
  placeholder,
  removeSelectedChips,
  selectAllChips,
  selectOnly,
  setDraft,
  setHighlight,
  setInputRef,
  setMenuOpen,
  setUnfolded,
  setWriting,
  showMenu,
  values,
  variant,
}: {
  blurTimerRef: ReturnType<typeof useRecipientMenu>["blurTimerRef"];
  cancelBlurTimer: ReturnType<typeof useChipSelection>["cancelBlurTimer"];
  chipNavRef: ReturnType<typeof useRecipientMenu>["chipNavRef"];
  clearChipSelection: ReturnType<typeof useChipSelection>["clearChipSelection"];
  commitDraft: ReturnType<typeof useRecipientCommit>["commitDraft"];
  draft: ReturnType<typeof useRecipientSources>["draft"];
  fieldElRef: ReturnType<typeof useRecipientMenu>["fieldElRef"];
  folding: ReturnType<typeof useRecipientLayout>["folding"];
  handleChipArrowKey: ReturnType<typeof useChipSelection>["handleChipArrowKey"];
  highlight: ReturnType<typeof useRecipientSources>["highlight"];
  keyMovedRef: ReturnType<typeof useRecipientSources>["keyMovedRef"];
  layout: ReturnType<typeof useRecipientLayout>["layout"];
  menu: ReturnType<typeof useRecipientMenu>["menu"];
  onChange: RecipientFieldProps["onChange"];
  onTabOut: RecipientFieldProps["onTabOut"];
  pickItem: ReturnType<typeof useRecipientCommit>["pickItem"];
  placeholder: RecipientFieldProps["placeholder"];
  removeSelectedChips: ReturnType<typeof useChipSelection>["removeSelectedChips"];
  selectAllChips: ReturnType<typeof useChipSelection>["selectAllChips"];
  selectOnly: ReturnType<typeof useChipSelection>["selectOnly"];
  setDraft: ReturnType<typeof useRecipientSources>["setDraft"];
  setHighlight: ReturnType<typeof useRecipientSources>["setHighlight"];
  setInputRef: ReturnType<typeof useRecipientMenu>["setInputRef"];
  setMenuOpen: ReturnType<typeof useRecipientMenu>["setMenuOpen"];
  setUnfolded: ReturnType<typeof useRecipientMenu>["setUnfolded"];
  setWriting: ReturnType<typeof useRecipientMenu>["setWriting"];
  showMenu: ReturnType<typeof useRecipientMenu>["showMenu"];
  values: RecipientFieldProps["values"];
  variant: Exclude<RecipientFieldProps["variant"], undefined>;
}) {
  return (
    <input
          ref={setInputRef}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            clearChipSelection();
            if (/[,;]\s*$/.test(next)) commitDraft(next);
            else {
              setDraft(next);
              setMenuOpen(true);
            }
          }}
          onFocus={() => {
            cancelBlurTimer();
            setWriting(true);
            if (chipNavRef.current.focusIndex == null) setMenuOpen(true);
          }}
          /*
            Addresses pasted in become chips at once, not text waiting for
            an Enter. That is what a paste of cut or copied chips expects,
            and a list from a spreadsheet or an email header too. Text with
            no address in it is left to the browser, as typing.
          */
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (!parseEmails(text).length) return;
            e.preventDefault();
            commitDraft(`${draft} ${text}`);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
              if (values.length) {
                e.preventDefault();
                selectAllChips();
                const input = e.currentTarget;
                const end = input.value.length;
                input.setSelectionRange(end, end);
              }
              return;
            }

            /**
             * Copy the selected chips.
             *
             * The cursor sits in the input, which has nothing selected, so
             * the browser's own copy would put an empty string on the
             * clipboard and the selection would look ignored.
             */
            if (
              (e.metaKey || e.ctrlKey) &&
              (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") &&
              chipNavRef.current.selected.size > 0
            ) {
              e.preventDefault();
              // Cut is copy and then take them out, the way text is cut:
              // the chips are gone from here and waiting on the clipboard
              // for the field they are meant for.
              const cutting = e.key.toLowerCase() === "x";
              const picked = values.filter((_, i) =>
                chipNavRef.current.selected.has(i)
              );
              const text = recipientsToClipboardText(picked);
              if (!text) return;
              void copyTextToClipboard(text).then((ok) => {
                if (!ok) {
                  toast.error(mailSay("couldNotCopy"));
                  return;
                }
                if (cutting) removeSelectedChips();
                const n = text.split(", ").length;
                toast(
                  `${n} address${n === 1 ? "" : "es"} ${cutting ? "cut" : "copied"}`
                );
              });
              return;
            }

            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              if (handleChipArrowKey(e, e.key === "ArrowLeft")) return;
            }

            const nav = chipNavRef.current;
            if (nav.selected.size > 0 || nav.focusIndex != null) {
              if (e.key === "Escape") {
                e.preventDefault();
                clearChipSelection();
                return;
              }
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                if (nav.selected.size > 0) removeSelectedChips();
                else if (nav.focusIndex != null) {
                  const idx = nav.focusIndex;
                  const next = values.filter((_, i) => i !== idx);
                  onChange(next);
                  const at = chipSelectionAfterRemoval(idx, next.length);
                  if (at == null) clearChipSelection();
                  else selectOnly(at);
                }
                return;
              }
              if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                clearChipSelection();
              }
            }

            if (showMenu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              keyMovedRef.current = true;
              setHighlight((h) => {
                if (e.key === "ArrowDown") return (h + 1) % menu.length;
                return (h - 1 + menu.length) % menu.length;
              });
              return;
            }
            if (e.key === "Escape" && showMenu) {
              e.preventDefault();
              setMenuOpen(false);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              if (showMenu && menu[highlight]) {
                e.preventDefault();
                pickItem(menu[highlight]);
                return;
              }
              if (draft.trim()) {
                e.preventDefault();
                commitDraft(draft);
                return;
              }
              if (e.key === "Tab" && !e.shiftKey && onTabOut) {
                e.preventDefault();
                onTabOut();
                return;
              }
            } else if (
              e.key === "Backspace" &&
              !draft &&
              nav.selected.size === 0 &&
              nav.focusIndex == null &&
              values.length
            ) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && fieldElRef.current?.contains(next)) {
              return;
            }
            blurTimerRef.current = window.setTimeout(() => {
              if (draft.trim()) commitDraft(draft);
              setMenuOpen(false);
              clearChipSelection();
              // Folded again on the way out, and the hand-unfold forgotten:
              // leaving the field is what says the writer is done with it.
              setWriting(false);
              setUnfolded(false);
            }, 120);
          }}
          placeholder={values.length ? "Add…" : placeholder}
          className={cn(
            variant === "boxed" && "min-w-[16ch]", // inline: TypingLine holds it
            "bg-transparent outline-none placeholder:text-stone-400",
            layout.input,
            // While the rest are folded away, "Add…" beside "and 24 more"
            // reads as a second thing to press. The field is one click from
            // being whole again, and that click puts the cursor here.
            folding && "sr-only",
            variant === "inline"
              ? "py-0.5 text-[15px] text-stone-800"
              : "py-0.5 text-sm"
          )}
          /*
            The Mac's own suggestions, switched off in this one box.

            Type "peter" and macOS puts up its own bubble — "Peter", with a
            cross — to capitalise it. While that bubble is up, the down
            arrow goes to it and not to the list underneath. The list is
            the suggestion here: this box holds names and addresses, which
            are neither misspelled nor in want of a capital, and the keys
            have to reach the app's list on the first press. Spellcheck and
            autocapitalize off with it, since each is a way for the system
            to take the keys.
          */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showMenu}
          aria-autocomplete="list"
        />
  );
}

/** The menu of suggestions under the field. */
function RecipientSuggestions({
  contactItems,
  editingList,
  hideHistory,
  highlight,
  listItems,
  menu,
  menuBox,
  menuRef,
  openListEditor,
  pickItem,
  setHighlight,
  setMenuOpen,
  showMenu,
  sourceSummaries,
  t,
  variant,
}: {
  contactItems: ReturnType<typeof useRecipientCommit>["contactItems"];
  editingList: ReturnType<typeof useRecipientCommit>["editingList"];
  hideHistory: ReturnType<typeof useRecipientMenu>["hideHistory"];
  highlight: ReturnType<typeof useRecipientSources>["highlight"];
  listItems: ReturnType<typeof useRecipientCommit>["listItems"];
  menu: ReturnType<typeof useRecipientMenu>["menu"];
  menuBox: ReturnType<typeof useRecipientCommit>["menuBox"];
  menuRef: ReturnType<typeof useRecipientSources>["menuRef"];
  openListEditor: ReturnType<typeof useRecipientCommit>["openListEditor"];
  pickItem: ReturnType<typeof useRecipientCommit>["pickItem"];
  setHighlight: ReturnType<typeof useRecipientSources>["setHighlight"];
  setMenuOpen: ReturnType<typeof useRecipientMenu>["setMenuOpen"];
  showMenu: ReturnType<typeof useRecipientMenu>["showMenu"];
  sourceSummaries: ReturnType<typeof useRecipientSources>["sourceSummaries"];
  t: ReturnType<typeof useRecipientSources>["t"];
  variant: Exclude<RecipientFieldProps["variant"], undefined>;
}) {
  return (
    <>{showMenu && !editingList ? (
          <ul
            ref={menuRef}
            role="listbox"
            // The reply band clips what hangs out of it; see mail.css.
            data-recipient-menu=""
            className={cn(
              "absolute z-30 overflow-y-auto border border-stone-200 bg-white py-1 shadow-lg",
              /*
                Joined to a boxed field: see the field's own classes. `-px`
                each side puts the list's border over the box's, since
                `left-0` is the inside of that border. With no margin the
                list's first line lies on the box's last one, so there is
                one line between them and not two. The inline field has no
                box to join, and keeps its small gap.
              */
              variant === "boxed"
                ? cn(
                    "-left-px -right-px border-stone-300",
                    menuBox.above
                      ? "bottom-full rounded-t-xl"
                      : "top-full rounded-b-xl"
                  )
                : cn(
                    /* As wide as the field, and never narrower than a name
                       and its address. In the reply card the Cc field is a
                       short strip beside Bcc and From. A list only that
                       wide cuts every name off. Wider, it runs on to
                       the right. */
                    "left-0 right-0 min-w-[18rem] rounded-surface",
                    menuBox.above ? "bottom-full mb-1" : "top-full mt-1"
                  )
            )}
            style={{ maxHeight: menuBox.maxHeight }}
          >
            {listItems.length ? (
              <>
                <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {t("lists")}
                </li>
                {listItems.map((item) => {
                  const i = menu.indexOf(item);
                  return (
                    <li
                      key={item.list.id}
                      role="option"
                      aria-selected={i === highlight}
                      /* The row is a button and the pencil is a button, so
                         the two cannot nest — the pencil rides alongside,
                         on a row that is the hover group. */
                      className={cn(
                        "group flex items-center",
                        i === highlight ? HIGHLIGHT_ROW : "hover:bg-stone-50"
                      )}
                      onMouseEnter={() => setHighlight(i)}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickItem(item);
                        }}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-teal-600 text-white">
                          <Users className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block truncate text-sm font-medium",
                              i === highlight
                                ? "text-[var(--mail-chrome-pinned-fg)]"
                                : "text-stone-900"
                            )}
                          >
                            {item.list.name}
                          </span>
                          <span
                            className={cn(
                              "block text-xs",
                              i === highlight
                                ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
                                : "text-stone-500"
                            )}
                          >
                            {listSubtitle(t, item.list.members.length)}
                          </span>
                        </span>
                      </button>
                      <EditListButton
                        onEdit={() => openListEditor(item.list)}
                        className={cn(
                          "mr-2",
                          i === highlight
                            ? "text-[var(--mail-chrome-pinned-fg)] opacity-70 hover:bg-white/15"
                            : "text-stone-400 hover:text-stone-700"
                        )}
                      />
                    </li>
                  );
                })}
              </>
            ) : null}
            {contactItems.length ? (
              <>
                {listItems.length ? (
                  <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    {t("people")}
                  </li>
                ) : null}
                {contactItems.map((item) => {
                  const i = menu.indexOf(item);
                  const badge = contactSourceBadge(item.contact, t);
                  // The Mac's address book, said with the apple rather than
                  // with a longer word: four things here are called Contacts.
                  const fromMac = item.contact.source === "mac";
                  const isHistory = item.contact.source === "history";
                  // Every row must show the address it will insert. A history
                  // row needs it most: the person is in no contact list, so
                  // the reader cannot know which of their addresses this is.
                  const emailedWhen = isHistory
                    ? historyEmailedWhen(item.contact.lastEmailedAt, t)
                    : null;
                  const subtitle = isHistory
                    ? emailedWhen
                      ? `${item.contact.email} · ${emailedWhen}`
                      : item.contact.email
                    : item.contact.name
                      ? item.contact.email
                      : item.contact.recordName || item.contact.email;
                  return (
                    <li
                      key={item.contact.email}
                      role="option"
                      aria-selected={i === highlight}
                      className="group"
                    >
                      <div
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2",
                          i === highlight ? HIGHLIGHT_ROW : "hover:bg-stone-50"
                        )}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickItem(item);
                          }}
                        >
                          {isHistory ? (
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                              <Clock className="h-4 w-4" aria-hidden />
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                                avatarTone(item.contact.email)
                              )}
                            >
                              {initials(item.contact.name, item.contact.email)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm font-medium",
                                i === highlight
                                  ? "text-[var(--mail-chrome-pinned-fg)]"
                                  : "text-stone-900"
                              )}
                            >
                              {item.contact.name || item.contact.email}
                            </span>
                            <span
                              className={cn(
                                "block truncate text-xs",
                                i === highlight
                                  ? "text-[var(--mail-chrome-pinned-fg)] opacity-70"
                                  : "text-stone-500"
                              )}
                              title={subtitle}
                            >
                              {subtitle}
                            </span>
                          </span>
                        </button>
                        {isHistory ? (
                          <button
                            type="button"
                            title={t("removeFromSuggestions")}
                            aria-label={`Remove ${item.contact.email} from suggestions`}
                            className="hidden shrink-0 rounded p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 group-hover:inline-flex"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void hideHistory(item.contact.email);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {badge ? (
                          <span
                            className={cn(
                              "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              provenanceBadgeClass(item.contact.source)
                            )}
                          >
                            {fromMac ? <AppleMark /> : null}
                            {badge}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </>
            ) : null}
            {sourceSummaries.length ? (
              <li className="mt-1 border-t border-stone-100 px-3 py-2 text-[11px] leading-relaxed text-stone-400">
                {formatSearchingFooter(sourceSummaries)}
                {" · "}
                <button
                  type="button"
                  className="font-medium text-teal-700 hover:underline"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    openContactSourcesDialog();
                  }}
                >
                  {t("manage")}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}</>
  );
}


