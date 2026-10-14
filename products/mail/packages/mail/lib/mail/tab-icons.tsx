"use client";

/**
 * An icon for each list tab, as To-Do's tabs have (2026-10-11).
 *
 * Any Lucide icon, stored by its kebab-case name, keyed by the tab's id:
 * "people", "other", or "list:<id>" for a list of one's own. In this
 * viewer's browser, beside the tab order and the schedules. A tab with no
 * icon shows its name alone.
 */

import * as React from "react";
import {
  Briefcase,
  Building2,
  Calendar,
  GraduationCap,
  HandCoins,
  Handshake,
  Heart,
  House,
  Landmark,
  Megaphone,
  Microscope,
  Newspaper,
  Plane,
  Receipt,
  School,
  Star,
  Users,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

export const MAIL_TAB_ICON_KEY = "redd-plan-mail-tab-icons";
const MAIL_TAB_ICON_EVENT = "redd-plan-mail-tab-icons-changed";

/** The swatches offered first in the list editor. */
const PRESET_ICONS: Record<string, LucideIcon> = {
  users: Users,
  handshake: Handshake,
  briefcase: Briefcase,
  "building-2": Building2,
  school: School,
  "graduation-cap": GraduationCap,
  microscope: Microscope,
  landmark: Landmark,
  "hand-coins": HandCoins,
  receipt: Receipt,
  megaphone: Megaphone,
  newspaper: Newspaper,
  calendar: Calendar,
  plane: Plane,
  house: House,
  heart: Heart,
  star: Star,
};
export const TAB_ICON_PRESETS = Object.keys(PRESET_ICONS);

const ICON_NAME_SET = new Set<string>(iconNames);

export function isTabIconId(value: string): boolean {
  return ICON_NAME_SET.has(value) || value in PRESET_ICONS;
}

export function allTabIconIds(): readonly string[] {
  return iconNames;
}

export type MailTabIcons = Record<string, string>;

export function readTabIcons(): MailTabIcons {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MAIL_TAB_ICON_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: MailTabIcons = {};
    for (const [tab, icon] of Object.entries(parsed)) {
      if (typeof icon === "string" && isTabIconId(icon)) out[tab] = icon;
    }
    return out;
  } catch {
    return {};
  }
}

/** Give a tab an icon, or take it away with "". */
export function setTabIcon(tab: string, icon: string): void {
  const next = { ...readTabIcons() };
  if (icon && isTabIconId(icon)) next[tab] = icon;
  else delete next[tab];
  try {
    localStorage.setItem(MAIL_TAB_ICON_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  cached = null;
  window.dispatchEvent(new Event(MAIL_TAB_ICON_EVENT));
}

let cached: MailTabIcons | null = null;
const EMPTY: MailTabIcons = {};

export function useTabIcons(): MailTabIcons {
  return React.useSyncExternalStore(
    (onChange) => {
      const listener = () => {
        cached = null;
        onChange();
      };
      window.addEventListener(MAIL_TAB_ICON_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(MAIL_TAB_ICON_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => (cached ??= readTabIcons()),
    () => EMPTY
  );
}

/** A tab's icon: a preset drawn at once, any other Lucide icon loaded. */
export function TabIcon({
  id,
  size = 14,
  ...props
}: { id: string; size?: number } & Omit<LucideProps, "ref" | "name">) {
  const Preset = PRESET_ICONS[id];
  if (Preset) return <Preset {...props} size={size} aria-hidden="true" />;
  return <DynamicIcon {...props} name={id as IconName} size={size} aria-hidden="true" />;
}
