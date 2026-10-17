"use client";

/**
 * The reply card over the thread can be put away and brought back.
 *
 * The card stays in place while the thread scrolls under it, so it covers
 * the end of the thread for as long as it is open. Minimised, it is a slim
 * bar at the bottom of the pane: who the reply is to, and a press brings
 * it back with everything in it (Ulrik, 2026-10-17). The composer holds the
 * state; the card's corner buttons put it away (ComposerCardButtons).
 */

import * as React from "react";

export type ComposerMinimise = {
  /** The card can be put away here: it stands over the thread. */
  available: boolean;
  minimised: boolean;
  setMinimised: (next: boolean) => void;
};

const Context = React.createContext<ComposerMinimise>({
  available: false,
  minimised: false,
  setMinimised: () => {},
});

export const ComposerMinimiseProvider = Context.Provider;

export function useComposerMinimise(): ComposerMinimise {
  return React.useContext(Context);
}
