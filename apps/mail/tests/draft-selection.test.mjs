/**
 * Selecting several drafts, as in the inbox.
 *
 * The Drafts list opened one draft per click. Shift-click now takes a range
 * and Cmd-click adds a row or takes it out; a plain click still opens one.
 * Invented rows only.
 */

import {
  clearDraftSelection,
  clickDraftRow,
  draftRowKey,
  draftSelectionNow,
  hideDraftRows,
  unhideDraftRows,
} from "@/components/mail/draft-selection-store";

import { check, suite } from "./harness.mjs";

const rows = ["a", "b", "c", "d", "e"].map((id) => ({
  id: `compose:${id}`, origin: "here", account: "vera@example.com", threadId: null,
  subject: id, snippet: "", to: [], updatedAt: null,
}));
const order = () => rows.map(draftRowKey);
const keys = () => [...draftSelectionNow().keys].sort();
const k = (i) => draftRowKey(rows[i]);

suite(async () => {
  check("a plain click opens the draft", clickDraftRow(rows[1], { shift: false, toggle: false }, order, null) === true);
  check("and selects none of several", draftSelectionNow().keys.size === 0);

  check("a Shift-click selects, it does not open", clickDraftRow(rows[3], { shift: true, toggle: false }, order, null) === false);
  check("from the clicked draft to this one, with those between", JSON.stringify(keys()) === JSON.stringify([k(1), k(2), k(3)].sort()), keys());

  // Cmd-click takes one out, and puts it back.
  clickDraftRow(rows[2], { shift: false, toggle: true }, order, null);
  check("Cmd-click takes a row out", JSON.stringify(keys()) === JSON.stringify([k(1), k(3)].sort()), keys());
  clickDraftRow(rows[4], { shift: false, toggle: true }, order, null);
  check("Cmd-click adds a row", keys().length === 3 && keys().includes(k(4)), keys());

  // A draft opened by itself (after a discard) is where a Shift-click counts from.
  clearDraftSelection();
  clickDraftRow(rows[0], { shift: false, toggle: false }, order, null);
  clearDraftSelection();
  check("a cleared selection holds nothing", draftSelectionNow().keys.size === 0);

  // With Cmd on the first click, the open draft joins, as in the inbox.
  clickDraftRow(rows[0], { shift: false, toggle: false }, order, null);
  clickDraftRow(rows[2], { shift: false, toggle: true }, order, null);
  check("Cmd-click after an open draft holds both", JSON.stringify(keys()) === JSON.stringify([k(0), k(2)].sort()), keys());

  // The anchor was discarded and the next draft opened by itself: a
  // Shift-click counts from the open draft, not from the one that is gone.
  clearDraftSelection();
  clickDraftRow(rows[0], { shift: false, toggle: false }, order, null);
  const without0 = () => rows.slice(1).map(draftRowKey);
  clickDraftRow(rows[3], { shift: true, toggle: false }, without0, k(1));
  check("a gone anchor gives way to the open draft", JSON.stringify(keys()) === JSON.stringify([k(1), k(2), k(3)].sort()), keys());

  hideDraftRows([k(0)]);
  check("a row being discarded is hidden", draftSelectionNow().hidden.has(k(0)));
  unhideDraftRows([k(0)]);
  check("and shown again on Undo", !draftSelectionNow().hidden.has(k(0)));
});
