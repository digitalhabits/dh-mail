"use client";

/*
 * The Drafts view's selection of several rows, for React. The state and its
 * rules are in draft-selection-store.ts, which has no React so a suite can
 * read it.
 */

import * as React from "react";

import {
  draftSelectionNow,
  subscribeDraftSelection,
  type DraftSelection,
} from "@/components/mail/draft-selection-store";

export {
  clearDraftSelection,
  clickDraftRow,
  draftRowKey,
  hideDraftRows,
  unhideDraftRows,
} from "@/components/mail/draft-selection-store";

export function useDraftSelection(): DraftSelection {
  return React.useSyncExternalStore(
    subscribeDraftSelection,
    draftSelectionNow,
    draftSelectionNow
  );
}
