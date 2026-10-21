"use client";

/*
 * The logic of RecipientField (RecipientField.tsx), in parts by concern.
 * RecipientField calls them in the order in which their hooks always ran,
 * so the effects run in the same order.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { CONTACTS_CHANGED_EVENT } from "@/components/mail/ContactSourcesDialog";
import {
  emailsOfRecipients,
  recipientKey,
  type MailContactList,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import { type MailContactSourceSummary } from "@/lib/mail/contact-suggestion";
import { chipSelectionAfterRemoval } from "@/lib/mail/recipient-chips";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { fieldLayout } from "@/components/mail/recipient-field-layout";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { type ContactSuggestion, type MenuItem, filterMenu, invalidateContactsCache, loadContacts, nameForEmail, parseEmails, selfSuggestionsFromAccounts, useContactLists } from "@/components/mail/recipient-suggestions";
import { useExchangeDirectory } from "@/components/mail/use-exchange-directory";
import { useRecipientCarry, useRecipientDrop, withRecipient } from "@/components/mail/recipient-carry";

import type { RecipientFieldProps } from "@/components/mail/RecipientField";

/** The words, the typed text, and where suggestions come from: contacts, the directory, saved lists. */
export function useRecipientSources({
  directoryAccount,
}: { directoryAccount: RecipientFieldProps["directoryAccount"] }) {
  const t = useMailT();
  const [draft, setDraft] = React.useState("");
  const directory = useExchangeDirectory(directoryAccount, draft);
  const [contacts, setContacts] = React.useState<ContactSuggestion[]>([]);
  const [sourceSummaries, setSourceSummaries] = React.useState<
    MailContactSourceSummary[]
  >([]);
  const lists = useContactLists();
  const [highlight, setHighlight] = React.useState(0);
  const menuRef = React.useRef<HTMLUListElement>(null);
  /** Set by the arrow keys: only a key move scrolls the row into view. */
  const keyMovedRef = React.useRef(false);
  React.useEffect(() => {
    if (!keyMovedRef.current) return;
    keyMovedRef.current = false;
    const row = menuRef.current?.querySelector('[role="option"][aria-selected="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  return { contacts, directory, draft, highlight, keyMovedRef, lists, menuRef, setContacts, setDraft, setHighlight, setSourceSummaries, sourceSummaries, t };
}

/** The suggestion menu, the chips' selection state, and the field's elements. */
export function useRecipientMenu({
  contacts,
  directory,
  draft,
  inputRef,
  lists,
  ownAccounts,
  setContacts,
  setHighlight,
  setSourceSummaries,
  t,
  values,
}: Pick<ReturnType<typeof useRecipientSources>, "contacts" | "directory" | "draft" | "lists" | "setContacts" | "setHighlight" | "setSourceSummaries" | "t"> &
  { inputRef: RecipientFieldProps["inputRef"]; ownAccounts: RecipientFieldProps["ownAccounts"]; values: RecipientFieldProps["values"] }) {
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
  const blurTimerRef = React.useRef<number | null>(null);
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
  }, [setContacts, setSourceSummaries]);
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
  }, [reloadContacts, setContacts, setSourceSummaries]);
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
  // so a richer name from a contact source is kept when present).
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
  // The directory's people after the contacts: a contact wins on its address.
  const withDirectory = React.useMemo(() => {
    const have = new Set(contactsForMenu.map((c) => c.email.toLowerCase()));
    const extra = directory.filter((d) => !have.has(d.email.toLowerCase()));
    return extra.length ? [...contactsForMenu, ...extra] : contactsForMenu;
  }, [contactsForMenu, directory]);
  // Again only when the words or the people change, not on every render.
  const menu = React.useMemo(() => filterMenu(draft, withDirectory, lists, values), [draft, withDirectory, lists, values]);
  const showMenu = menuOpen && menu.length > 0;
  React.useEffect(() => {
    setHighlight(0);
  }, [draft, values.length, setHighlight]);
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
  return { blurTimerRef, chipNavRef, fieldElRef, hideHistory, inputElRef, menu, selected, setAnchor, setFocusIndex, setInputRef, setMenuOpen, setSelected, setUnfolded, setWriting, showMenu, unfolded, writing };
}

/** Selecting chips with the mouse and the keys, and removing them. */
export function useChipSelection({
  blurTimerRef,
  chipNavRef,
  draft,
  inputElRef,
  onChange,
  setAnchor,
  setFocusIndex,
  setMenuOpen,
  setSelected,
  values,
}: Pick<ReturnType<typeof useRecipientSources>, "draft"> &
  Pick<ReturnType<typeof useRecipientMenu>, "blurTimerRef" | "chipNavRef" | "inputElRef" | "setAnchor" | "setFocusIndex" | "setMenuOpen" | "setSelected"> &
  { onChange: RecipientFieldProps["onChange"]; values: RecipientFieldProps["values"] }) {
  const cancelBlurTimer = React.useCallback(() => {
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, [blurTimerRef]);
  const focusDraftInput = React.useCallback(() => {
    cancelBlurTimer();
    const el = inputElRef.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, [cancelBlurTimer, inputElRef]);
  const cursorAtDraftStart = React.useCallback(
    (el: HTMLInputElement | null = inputElRef.current) => {
      if (!el) return !draft;
      return el.selectionStart === 0 && el.selectionEnd === 0;
    },
    [draft, inputElRef]
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
  }, [chipNavRef, setAnchor, setFocusIndex, setSelected]);
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
  }, [chipNavRef, setAnchor, setFocusIndex, setMenuOpen, setSelected]);
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
  }, [chipNavRef, setFocusIndex, setMenuOpen, setSelected]);
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
  }, [values.length, chipNavRef, setAnchor, setFocusIndex, setMenuOpen, setSelected]);
  const removeSelectedChips = React.useCallback(() => {
    const { selected: sel } = chipNavRef.current;
    if (!sel.size) return;
    const next = values.filter((_, i) => !sel.has(i));
    onChange(next);
    // Where the block began is where the writer was looking.
    const at = chipSelectionAfterRemoval(Math.min(...sel), next.length);
    if (at == null) clearChipSelection();
    else selectOnly(at);
  }, [values, onChange, clearChipSelection, selectOnly, chipNavRef]);
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
    [selectOnly, selectRange, focusDraftInput, chipNavRef]
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
    [draft, cursorAtDraftStart, selectOnly, selectRange, clearChipSelection, chipNavRef, inputElRef]
  );
  return { cancelBlurTimer, clearChipSelection, focusDraftInput, handleChipArrowKey, handleChipSelect, removeSelectedChips, selectAllChips, selectOnly };
}

/** Turning typed text or a suggestion into chips, saved lists, and where the menu stands. */
export function useRecipientCommit({
  allowSaveList,
  cancelBlurTimer,
  clearChipSelection,
  contacts,
  fieldElRef,
  lists,
  menu,
  onChange,
  setDraft,
  setMenuOpen,
  showMenu,
  values,
}: Pick<ReturnType<typeof useRecipientSources>, "contacts" | "lists" | "setDraft"> &
  Pick<ReturnType<typeof useRecipientMenu>, "fieldElRef" | "menu" | "setMenuOpen" | "showMenu"> &
  Pick<ReturnType<typeof useChipSelection>, "cancelBlurTimer" | "clearChipSelection"> &
  { allowSaveList: Exclude<RecipientFieldProps["allowSaveList"], undefined>; onChange: RecipientFieldProps["onChange"]; values: RecipientFieldProps["values"] }) {
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
  }, [showMenu, editingList, fieldElRef]);
  return { commitDraft, contactItems, editingList, emailPeople, listItems, menuBox, openListEditor, pickItem, setEditingList, showSaveList };
}

/** Folding a long list, and carrying chips between fields. */
export function useRecipientLayout({
  clearChipSelection,
  collapseAfter,
  onChange,
  unfolded,
  values,
  variant,
  writing,
}: Pick<ReturnType<typeof useRecipientMenu>, "unfolded" | "writing"> &
  Pick<ReturnType<typeof useChipSelection>, "clearChipSelection"> &
  { collapseAfter: RecipientFieldProps["collapseAfter"]; onChange: RecipientFieldProps["onChange"]; values: RecipientFieldProps["values"]; variant: Exclude<RecipientFieldProps["variant"], undefined> }) {
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
    Carrying somebody from this field to another (recipient-carry.tsx).

    The chip says what it is and how to take it out of here; the place it
    is dropped on adds it and then calls that. So neither field knows the
    other exists — which is what lets To, Cc and Bcc trade without a
    composer standing between them holding all three.
  */
  const carry = useRecipientCarry();
  const fieldId = React.useId();
  // Already here: the move is only a removal from where it was.
  const drop = useRecipientDrop(fieldId, (r) => {
    const next = withRecipient(values, r);
    if (next !== values) onChange(next);
  });
  const carryProps = (value: MailRecipient) =>
    carry
      ? {
          onPointerDown: (event: React.PointerEvent) =>
            carry.lift(
              event,
              {
                fromId: fieldId,
                recipient: value,
                takeFromSource: () =>
                  onChange(
                    values.filter((v) => recipientKey(v) !== recipientKey(value))
                  ),
              },
              // The mouse going down selected this chip; once it has gone
              // the ring would fall on the next chip, and a Backspace
              // would take that one.
              clearChipSelection
            ),
        }
      : undefined;
  /*
    A boxed field with nobody in it yet is one row: the label, the place to
    type, and the lists button, side by side. The place to type takes all
    the room there is, so the placeholder runs up to the button. A fixed
    4.5rem kept free for the other two is more than they take, and cuts the
    placeholder short.
  */
  const emptyRow = variant === "boxed" && !shownValues.length && !folding;
  const layout = fieldLayout(variant, emptyRow);
  return { carryProps, drop, foldedCount, folding, layout, shownValues };
}
