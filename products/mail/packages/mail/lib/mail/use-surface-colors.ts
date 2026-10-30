"use client";

/** The React side of lib/mail/surface-colors: read the colours, apply them. */

import * as React from "react";
import {
  applySurfaceColors,
  readSurfaceColors,
  subscribeSurfaceColors,
  type SurfaceColors,
} from "@/lib/mail/surface-colors";

export function useSurfaceColors(): SurfaceColors {
  return React.useSyncExternalStore(subscribeSurfaceColors, readSurfaceColors, () => ({}));
}

/** Keeps <html> in step with the reader's colours. Call once, in the page. */
export function useApplySurfaceColors(): void {
  const colors = useSurfaceColors();
  React.useLayoutEffect(() => {
    applySurfaceColors(colors);
  }, [colors]);
}
