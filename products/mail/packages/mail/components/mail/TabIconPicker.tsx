"use client";

/**
 * The icon row of the list editor, as in To-Do's list editor: a row of
 * swatches, and "+" to search every Lucide icon. A press on the chosen
 * swatch takes the icon away.
 */

import * as React from "react";
import { Plus, X } from "lucide-react";

import { TAB_ICON_PRESETS, TabIcon, allTabIconIds } from "@/lib/mail/tab-icons";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

const PICKER_LIMIT = 180;

const swatch = (on: boolean) =>
  cn(
    "flex h-7 w-7 items-center justify-center rounded-inner border text-stone-600 hover:bg-stone-100",
    on ? "border-teal-600 bg-teal-50 text-teal-800" : "border-stone-200"
  );

export function TabIconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const t = useMailT();
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const found = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    const all = allTabIconIds();
    return (q ? all.filter((id) => id.includes(q)) : all).slice(0, PICKER_LIMIT);
  }, [query]);
  const custom = Boolean(value) && !TAB_ICON_PRESETS.includes(value);
  return (
    <div className="mt-2.5" data-tab-icon-picker>
      <p className="mb-1.5 text-xs text-stone-500">{t("listIcon")}</p>
      <div className="flex flex-wrap gap-1">
        {TAB_ICON_PRESETS.map((id) => (
          <button
            key={id}
            type="button"
            title={id}
            aria-label={id}
            aria-pressed={value === id}
            className={swatch(value === id)}
            onClick={() => onChange(value === id ? "" : id)}
          >
            <TabIcon id={id} size={15} />
          </button>
        ))}
        <button
          type="button"
          title={t("listIconSearch")}
          aria-label={t("listIconSearch")}
          aria-expanded={searching}
          className={swatch(custom || searching)}
          onClick={() => setSearching((v) => !v)}
        >
          {custom ? <TabIcon id={value} size={15} /> : <Plus className="h-3.5 w-3.5" />}
        </button>
        {value ? (
          <button
            type="button"
            title={t("listIconNone")}
            aria-label={t("listIconNone")}
            className={swatch(false)}
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {searching ? (
        <div className="mt-2 rounded-control border border-stone-200 p-2">
          <input
            autoFocus
            type="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("listIconSearch")}
            className="mb-2 w-full rounded-inner border border-stone-200 px-2 py-1 text-sm outline-none focus:border-teal-600"
          />
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
            {found.map((id) => (
              <button
                key={id}
                type="button"
                title={id}
                aria-label={id}
                className={swatch(value === id)}
                onClick={() => {
                  onChange(id);
                  setSearching(false);
                  setQuery("");
                }}
              >
                <TabIcon id={id} size={15} />
              </button>
            ))}
          </div>
          {found.length === 0 ? <p className="text-xs text-stone-500">{t("listIconNoMatch")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
