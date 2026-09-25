"use client";

/*
 * The list's tabs, off useMailPage: the built-in filters and the reader's
 * own lists, which one is open, their order and its drag, their schedules,
 * and the editor for one of them.
 *
 * The hooks inside run in the order they always ran; useMailPage calls
 * this hook where they stood. No effects of its own.
 */

import * as React from "react";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { parseCustomListTabId, type MailCustomList } from "@/lib/mail/custom-lists";
import { useTabSchedules } from "@/lib/mail/tab-schedules";
import { MAIL_LIST_TABS, useMailCustomLists, useMailListTabOrder, useMailListTab } from "@/components/mail/mail-list-state";

export function useListTabs() {
  const customLists = useMailCustomLists();
  const customListById = React.useMemo(() => {
    const map = new Map<string, MailCustomList>();
    for (const list of customLists) map.set(list.id, list);
    return map;
  }, [customLists]);
  const [tab, setTab] = useMailListTab(customLists);
  const [tabOrder, setTabOrder] = useMailListTabOrder(customLists);
  const tabReorderSuppressClick = React.useRef(false);
  const tabReorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  /** null = closed; create = new list; string = editing that list id. */
  const tabSchedules = useTabSchedules();
  const [listEditor, setListEditor] = React.useState<
    null | "create" | string
  >(null);
  /**
   * The built-in filter whose schedule is open, if that is what is open.
   *
   * The editor takes one of three things: nothing (a new list), one of the
   * reader's lists, or one of the four built-in filters — and for a built-in
   * there is only ever the schedule to change.
   */
  const editingBuiltin =
    typeof listEditor === "string" && MAIL_LIST_TABS.includes(listEditor)
      ? listEditor
      : null;
  const editingList =
    typeof listEditor === "string"
      ? customListById.get(listEditor) ?? null
      : null;
  const activeCustomListId = parseCustomListTabId(tab);
  const activeCustomList = activeCustomListId
    ? customListById.get(activeCustomListId) ?? null
    : null;

  return {
    customListById,
    tab,
    setTab,
    tabOrder,
    setTabOrder,
    tabReorderSuppressClick,
    tabReorderSensors,
    tabSchedules,
    listEditor,
    setListEditor,
    editingBuiltin,
    editingList,
    activeCustomList,
  };
}
