"use client";

/**
 * The account's default font and size for the composer and the Aa menu: the
 * React half of lib/mail/text-style, which the send code uses without React.
 */

import * as React from "react";

import {
  TEXT_STYLE_FALLBACK,
  fontStack,
  getRecentFonts,
  getTextStyleDefault,
  listInstalledFonts,
  onRecentFontsChange,
  onTextStyleDefaultChange,
  type TextStyle,
} from "@/lib/mail/text-style";

/** The account's default, kept current when it is changed anywhere. */
export function useTextStyleDefault(account: string | null | undefined): TextStyle {
  const [style, setStyle] = React.useState<TextStyle>(TEXT_STYLE_FALLBACK);
  React.useEffect(() => {
    let live = true;
    void getTextStyleDefault(account).then((next) => {
      if (live) setStyle(next);
    });
    const key = account?.trim().toLowerCase();
    const listener = (changed: string, next: TextStyle) => {
      if (changed === key) setStyle(next);
    };
    const stop = onTextStyleDefaultChange(listener);
    return () => {
      live = false;
      stop();
    };
  }, [account]);
  return style;
}

/** The composer's box shows the default: these are read by mail.css. */
export function textStyleVars(style: TextStyle): React.CSSProperties {
  return {
    ["--mail-text-font" as string]: fontStack(style.font),
    ["--mail-text-size" as string]: `${style.size}pt`,
  };
}


/** The fonts picked lately, newest first, kept current. */
export function useRecentFonts(): string[] {
  const [fonts, setFonts] = React.useState<string[]>([]);
  React.useEffect(() => {
    let live = true;
    void getRecentFonts().then((next) => {
      if (live) setFonts(next);
    });
    const stop = onRecentFontsChange(setFonts);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return fonts;
}

/** The fonts on this computer, once asked for (when the font list opens). */
export function useInstalledFonts(wanted: boolean): string[] | null {
  const [fonts, setFonts] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!wanted) return;
    let live = true;
    void listInstalledFonts().then((names) => {
      if (live) setFonts(names);
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return fonts;
}
