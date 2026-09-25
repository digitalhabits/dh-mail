"use client";

import * as React from "react";
import { Clock, Users, X } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  CONTACTS_CHANGED_EVENT,
  openContactSourcesDialog,
} from "@/components/mail/ContactSourcesDialog";
import { AppleMark } from "@/components/mail/AccountMark";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  emailsOfRecipients,
  recipientKey,
  type MailContactList,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  contactSourceBadge,
  historyEmailedWhen,
  type MailContactSourceSummary,
} from "@/lib/mail/contact-suggestion";
import {
  chipSelectionAfterRemoval,
  recipientsToClipboardText,
} from "@/lib/mail/recipient-chips";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  type ContactSuggestion,
  HIGHLIGHT_ROW,
  type MenuItem,
  avatarTone,
  filterMenu,
  formatSearchingFooter,
  initials,
  invalidateContactsCache,
  loadContacts,
  nameForEmail,
  parseEmails,
  provenanceBadgeClass,
  selfSuggestionsFromAccounts,
  useContactLists,
} from "@/components/mail/recipient-suggestions";
import {
  EditListButton,
  ListChip,
  ListEditorCard,
  ListsMenu,
  SaveAsListControl,
  listSubtitle,
} from "@/components/mail/recipient-lists";

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
/**
 * A recipient being carried from one field to another.
 *
 * To, Cc and Bcc are three fields that do not know about each other, and
 * moving somebody between them meant taking them out of one and typing
 * them into the next. The chip carries what it is and how to take it out
 * of where it came from, so the field it lands on can finish the move by
 * itself — no field has to know what the others are.
 *
 * Without a provider round them there is nothing to carry to, and the
 * chips are simply not draggable.
 */
type CarriedRecipient = {
  fieldId: string;
  recipient: MailRecipient;
  /** Take it out of the field it came from, once it has landed. */
  takeFromSource: () => void;
};

const RecipientCarry = React.createContext<{
  carried: CarriedRecipient | null;
  setCarried: (next: CarriedRecipient | null) => void;
} | null>(null);

export function RecipientCarryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [carried, setCarried] = React.useState<CarriedRecipient | null>(null);
  const value = React.useMemo(() => ({ carried, setCarried }), [carried]);
  return (
    <RecipientCarry.Provider value={value}>{children}</RecipientCarry.Provider>
  );
}

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
  carry?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const label = recipient.name || recipient.email;
  const known = contacts.find(
    (c) => c.email.trim().toLowerCase() === recipient.email.trim().toLowerCase()
  );
  const badge = known ? contactSourceBadge(known) : null;

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
             the mouse coming up hands focus back. The default used to be
             cancelled instead, which kept the focus but also kept WebKit
             from starting a drag — a chip could be selected but never
             carried to another field. */
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
             focus with it — so a chip picked with the mouse could not be
             cut or copied, the keys went to the card. Marking the click
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
            {t(badge)}
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

/** Editable To/Cc/Bcc field with CRM contacts + saved contact lists. */
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
}: {
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
}) {
  const t = useMailT();
  const [draft, setDraft] = React.useState("");
  const [contacts, setContacts] = React.useState<ContactSuggestion[]>([]);
  const [sourceSummaries, setSourceSummaries] = React.useState<
    MailContactSourceSummary[]
  >([]);
  const lists = useContactLists();
  const [highlight, setHighlight] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  /** True while the writer is in this field: chips stay whole while editing. */
  const [writing, setWriting] = React.useState(false);
  /** Unfolded by hand, and stays unfolded until the field is left. */
  const [unfolded, setUnfolded] = React.useState(false);
  /** Indices of selected chips; empty = typing in the draft input. */
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  /** Anchor for shift-click / shift-arrow range selection. */
  const [anchor, setAnchor] = React.useState<number | null>(null);
  /** Focused chip while navigating with arrows (`null` = draft input). */
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const blurTimer = React.useRef<number | null>(null);
  const inputElRef = React.useRef<HTMLInputElement | null>(null);
  const fieldElRef = React.useRef<HTMLDivElement | null>(null);
  // Keep latest selection in refs so key handlers never see a stale focusIndex
  // after a chip click in the same tick / before re-render.
  const chipNavRef = React.useRef({
    selected,
    anchor,
    focusIndex,
    valuesLength: values.length,
  });
  chipNavRef.current = {
    selected,
    anchor,
    focusIndex,
    valuesLength: values.length,
  };

  const setInputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      inputElRef.current = el;
      if (!inputRef) return;
      if (typeof inputRef === "object") {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current =
          el;
      }
    },
    [inputRef]
  );

  const reloadContacts = React.useCallback(() => {
    invalidateContactsCache();
    return loadContacts().then((payload) => {
      setContacts(payload.contacts);
      setSourceSummaries(payload.sources);
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadContacts().then((payload) => {
      if (!cancelled) {
        setContacts(payload.contacts);
        setSourceSummaries(payload.sources);
      }
    });
    const onChanged = () => {
      void reloadContacts();
    };
    window.addEventListener(CONTACTS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(CONTACTS_CHANGED_EVENT, onChanged);
    };
  }, [reloadContacts]);

  const hideHistory = async (email: string) => {
    try {
      await apiJson("/api/mail/contact-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideEmail: email }),
      });
      await reloadContacts();
      toast.success(mailSay("removedFromSuggestions"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove");
    }
  };

  // Merge shell-provided mailboxes with API contacts (API wins on same email
  // so a richer name from CRM/history is kept when present).
  const contactsForMenu = React.useMemo(() => {
    const own = selfSuggestionsFromAccounts(ownAccounts);
    if (!own.length) return contacts;
    const byEmail = new Map<string, ContactSuggestion>();
    for (const row of own) byEmail.set(row.email.toLowerCase(), row);
    for (const row of contacts) {
      const key = row.email.toLowerCase();
      const prev = byEmail.get(key);
      if (!prev) {
        byEmail.set(key, row);
        continue;
      }
      // Keep whichever real name there is, and no word standing in for one:
      // an own mailbox that nothing knows a name for is shown by its
      // address, the way every other nameless contact is.
      byEmail.set(key, {
        ...row,
        name: row.name || prev.name,
        recordName: row.recordName || prev.recordName || t("yourMailbox"),
        source: row.source === "self" || prev.source === "self" ? "self" : row.source,
      });
    }
    return [...byEmail.values()];
  }, [contacts, ownAccounts, t]);

  const menu = filterMenu(draft, contactsForMenu, lists, values);
  const showMenu = menuOpen && menu.length > 0;

  React.useEffect(() => {
    setHighlight(0);
  }, [draft, values.length]);

  React.useEffect(() => {
    if (!values.length) {
      setSelected(new Set());
      setAnchor(null);
      setFocusIndex(null);
      return;
    }
    setSelected((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i >= 0 && i < values.length) next.add(i);
      }
      return next.size === prev.size ? prev : next;
    });
    setFocusIndex((i) =>
      i == null || i < values.length ? i : values.length - 1
    );
    setAnchor((a) =>
      a == null || a < values.length ? a : values.length - 1
    );
  }, [values.length]);

  const cancelBlurTimer = React.useCallback(() => {
    if (blurTimer.current != null) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  }, []);

  const focusDraftInput = React.useCallback(() => {
    cancelBlurTimer();
    const el = inputElRef.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, [cancelBlurTimer]);

  const cursorAtDraftStart = React.useCallback(
    (el: HTMLInputElement | null = inputElRef.current) => {
      if (!el) return !draft;
      return el.selectionStart === 0 && el.selectionEnd === 0;
    },
    [draft]
  );

  const clearChipSelection = React.useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
    setFocusIndex(null);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: new Set(),
      anchor: null,
      focusIndex: null,
    };
  }, []);

  const selectOnly = React.useCallback((index: number) => {
    const next = new Set([index]);
    setSelected(next);
    setAnchor(index);
    setFocusIndex(index);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      anchor: index,
      focusIndex: index,
    };
  }, []);

  const selectRange = React.useCallback((from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    setSelected(next);
    setFocusIndex(to);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      focusIndex: to,
    };
  }, []);

  const selectAllChips = React.useCallback(() => {
    if (!values.length) return;
    const next = new Set<number>();
    for (let i = 0; i < values.length; i++) next.add(i);
    setSelected(next);
    setAnchor(0);
    setFocusIndex(values.length - 1);
    setMenuOpen(false);
    chipNavRef.current = {
      ...chipNavRef.current,
      selected: next,
      anchor: 0,
      focusIndex: values.length - 1,
    };
  }, [values.length]);

  const removeSelectedChips = React.useCallback(() => {
    const { selected: sel } = chipNavRef.current;
    if (!sel.size) return;
    const next = values.filter((_, i) => !sel.has(i));
    onChange(next);
    // Where the block began is where the writer was looking.
    const at = chipSelectionAfterRemoval(Math.min(...sel), next.length);
    if (at == null) clearChipSelection();
    else selectOnly(at);
  }, [values, onChange, clearChipSelection, selectOnly]);

  const handleChipSelect = React.useCallback(
    (index: number, e: React.MouseEvent) => {
      const { anchor: currentAnchor } = chipNavRef.current;
      if (e.shiftKey && currentAnchor != null) {
        selectRange(currentAnchor, index);
      } else {
        selectOnly(index);
      }
      // The chip takes focus on mouse-down and hands it back on mouse-up.
      // Focus the input here too, for a selection made without a mouse.
      focusDraftInput();
    },
    [selectOnly, selectRange, focusDraftInput]
  );

  /** Arrow / delete navigation among recipient chips (Gmail-style). */
  const handleChipArrowKey = React.useCallback(
    (e: React.KeyboardEvent, goingLeft: boolean) => {
      const nav = chipNavRef.current;
      const count = nav.valuesLength;
      if (!count) return false;

      const inChipMode = nav.focusIndex != null;
      const canEnterChips =
        !draft &&
        (inChipMode || (goingLeft && cursorAtDraftStart(inputElRef.current)));

      if (!canEnterChips && !inChipMode) return false;

      if (!inChipMode && goingLeft) {
        e.preventDefault();
        selectOnly(count - 1);
        return true;
      }
      if (!inChipMode) return false;

      e.preventDefault();
      const current = nav.focusIndex ?? 0;
      const anchorAt = nav.anchor ?? current;

      if (goingLeft) {
        if (current <= 0) {
          if (!e.shiftKey) selectOnly(0);
          return true;
        }
        const next = current - 1;
        if (e.shiftKey) selectRange(anchorAt, next);
        else selectOnly(next);
        return true;
      }

      // ArrowRight
      if (current >= count - 1) {
        if (!e.shiftKey) {
          clearChipSelection();
        }
        return true;
      }
      const next = current + 1;
      if (e.shiftKey) selectRange(anchorAt, next);
      else selectOnly(next);
      return true;
    },
    [draft, cursorAtDraftStart, selectOnly, selectRange, clearChipSelection]
  );

  const commitDraft = (raw: string) => {
    const added = parseEmails(raw);
    if (!added.length) {
      setDraft("");
      setMenuOpen(false);
      return;
    }
    const next = [...values];
    const seen = new Set(emailsOfRecipients(values));
    for (const email of added) {
      if (seen.has(email)) continue;
      seen.add(email);
      next.push({
        kind: "email",
        email,
        name: nameForEmail(email, contacts),
      });
    }
    onChange(next);
    setDraft("");
    setMenuOpen(false);
    clearChipSelection();
  };

  const pickItem = (item: MenuItem) => {
    cancelBlurTimer();
    clearChipSelection();
    if (item.kind === "list") {
      if (values.some((v) => v.kind === "list" && v.listId === item.list.id)) {
        setDraft("");
        setMenuOpen(false);
        return;
      }
      onChange([
        ...values,
        {
          kind: "list",
          listId: item.list.id,
          name: item.list.name,
          members: item.list.members,
        },
      ]);
    } else {
      const email = item.contact.email.trim().toLowerCase();
      if (!values.some((v) => v.kind === "email" && v.email === email)) {
        onChange([
          ...values,
          {
            kind: "email",
            email,
            name: item.contact.name || undefined,
          },
        ]);
      }
    }
    setDraft("");
    setMenuOpen(false);
  };

  const emailPeople = values.filter(
    (v): v is Extract<MailRecipient, { kind: "email" }> => v.kind === "email"
  );
  const showSaveList = allowSaveList && emailPeople.length >= 2;

  const listItems = menu.filter((i) => i.kind === "list");
  const contactItems = menu.filter((i) => i.kind === "contact");
  /** The list the pencil was pressed on, from wherever it was pressed. */
  const [editingList, setEditingList] = React.useState<MailContactList | null>(
    null
  );
  const openListEditor = (list: MailContactList) => {
    cancelBlurTimer();
    // Whatever was half-typed is not an address, and committing it on the
    // way out would leave a chip nobody asked for behind the editor.
    setDraft("");
    setMenuOpen(false);
    setEditingList(list);
  };
  // A list edited elsewhere, or deleted, must not stay open on the old copy.
  React.useEffect(() => {
    if (!editingList) return;
    const fresh = lists.find((l) => l.id === editingList.id);
    if (!fresh) setEditingList(null);
  }, [lists, editingList]);

  /**
   * How much of the menu there is room for, and which way it opens.
   *
   * It hung a fixed height below the field, which is fine in the middle of a
   * window and runs off the bottom of one anywhere near it — the addresses
   * furthest down the list were the ones nobody could reach.
   */
  const [menuBox, setMenuBox] = React.useState({
    above: false,
    maxHeight: 288,
    /** The whole drop, before the menu's own cap — the editor wants more. */
    room: 288,
  });
  React.useEffect(() => {
    if (!showMenu && !editingList) return;
    const measure = () => {
      const el = fieldElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 12;
      // The room is measured in screen pixels and spent in the field's
      // own, and the two differ by whatever `zoom` the composer card is
      // under: at 122% a menu given the room it measured ran a fifth past
      // the bottom of the window. The field's rect against its offset
      // height is that zoom, whatever ancestor carries it.
      const scale = el.offsetHeight ? rect.height / el.offsetHeight : 1;
      const below = (window.innerHeight - rect.bottom - margin) / scale;
      const above = (rect.top - margin) / scale;
      // Downwards by default, which is where a reader expects it. Upwards
      // only when there is really no room and more of it the other way.
      const flip = below < 200 && above > below;
      const drop = flip ? above : below;
      setMenuBox({
        above: flip,
        maxHeight: Math.max(140, Math.min(288, drop)),
        room: Math.max(140, drop),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showMenu, editingList]);

  /**
   * The chips actually drawn, and how many are folded away.
   *
   * Folded only while the field is at rest: typing in it, or unfolding by
   * hand, shows them all. A chip that cannot be seen cannot be removed, so
   * this never hides one from somebody working on the list.
   */
  const folding =
    collapseAfter != null &&
    !writing &&
    !unfolded &&
    values.length > collapseAfter;
  const shownValues = folding ? values.slice(0, collapseAfter) : values;
  const foldedCount = values.length - shownValues.length;

  /*
    Carrying somebody from this field to another.

    The chip says what it is and how to take it out of here; the field it
    is dropped on adds it and then calls that. So neither field knows the
    other exists — which is what lets To, Cc and Bcc trade without a
    composer standing between them holding all three.
  */
  const carry = React.useContext(RecipientCarry);
  const fieldId = React.useId();
  const [carriedOver, setCarriedOver] = React.useState(false);
  const carriedFromElsewhere =
    carry?.carried != null && carry.carried.fieldId !== fieldId;

  const carryProps = (value: MailRecipient) =>
    carry
      ? {
          draggable: true,
          onDragStart: (event: React.DragEvent) => {
            // Something has to be on the drag or the browser refuses it.
            event.dataTransfer.setData("text/plain", recipientKey(value));
            event.dataTransfer.effectAllowed = "move";
            // The mouse going down selected this chip and no mouse-up will
            // follow; once it has gone the ring would fall on the next
            // chip, and a Backspace would take that one.
            clearChipSelection();
            carry.setCarried({
              fieldId,
              recipient: value,
              takeFromSource: () =>
                onChange(
                  values.filter((v) => recipientKey(v) !== recipientKey(value))
                ),
            });
          },
          onDragEnd: () => carry.setCarried(null),
        }
      : undefined;

  const dropProps = carry
    ? {
        onDragOver: (event: React.DragEvent) => {
          if (!carriedFromElsewhere) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move" as const;
          if (!carriedOver) setCarriedOver(true);
        },
        onDragLeave: (event: React.DragEvent) => {
          // Only when the pointer has left the field, not one of its chips.
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setCarriedOver(false);
        },
        onDrop: (event: React.DragEvent) => {
          setCarriedOver(false);
          const carried = carry.carried;
          if (!carried || carried.fieldId === fieldId) return;
          event.preventDefault();
          carry.setCarried(null);
          // Already here: the move is only a removal from where it was.
          const here = new Set(values.map((v) => recipientKey(v)));
          if (!here.has(recipientKey(carried.recipient))) {
            onChange([...values, carried.recipient]);
          }
          carried.takeFromSource();
        },
      }
    : undefined;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 flex-wrap items-start gap-1.5",
        className
      )}
      /* On the whole field, not on the box inside it: a chip is let go
         over the row it is meant for, and the gaps between the chips are
         as much a part of that row as the chips are. */
      {...dropProps}
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
          carriedOver &&
            carriedFromElsewhere &&
            "rounded-xl ring-2 ring-teal-500/60",
          /* Block rather than flex when the field has a box round it, so
             "Save as list…" can float into its top right corner: the chips
             wrap around it on the first line and take the whole width
             below. As a flex item it could only be a column of its own,
             beside the box, which cost more room than the addresses. */
          variant === "boxed"
            ? "rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 focus-within:border-stone-300"
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
          <span className={cn("text-xs text-muted-foreground", "mr-1.5")}>
            {label}
          </span>
        ) : null}
        {shownValues.map((value, index) => {
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
        })}
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
            blurTimer.current = window.setTimeout(() => {
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
            "min-w-[16ch] bg-transparent outline-none placeholder:text-stone-400",
            variant === "boxed"
              ? // Wide enough to type in, and it takes the rest of the line
                // rather than a line of its own. Empty, it shows the
                // placeholder, which is longer than sixteen letters: it
                // takes the line, less the label and the list button.
                cn(
                  "mb-1 max-w-full align-middle",
                  values.length ? "w-[16ch]" : "w-[calc(100%-4.5rem)]"
                )
              : "flex-1",
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

            Type "peter" and macOS put up its own bubble — "Peter", with a
            cross — to capitalise it, and while that bubble was up the down
            arrow went to it and not to the list underneath. The list is
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
            className={variant === "boxed" ? "float-right ml-2" : "ml-auto"}
          />
        ) : null}
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
        {showMenu && !editingList ? (
          <ul
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
                    "left-0 right-0 rounded-lg",
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
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
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
                  const badgeKey = contactSourceBadge(item.contact);
                  const badge = badgeKey ? t(badgeKey) : null;
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
        ) : null}
      </div>
      {(showSaveList && variant !== "boxed") || actions ? (
        /* A column, not a row: "Save as list…" is a thing you do to the
           addresses above it, and Cc/Bcc are two more fields to open. Side
           by side they read as three of a kind. */
        <span className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
          {showSaveList && variant !== "boxed" ? (
            <SaveAsListControl
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
