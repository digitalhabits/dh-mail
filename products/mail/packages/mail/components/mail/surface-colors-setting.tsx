"use client";

/**
 * Settings > General > Colours: a colour for each part of the window — the
 * top bar, the folder list, the mail list, its header, and the background
 * behind a thread. Light theme only. See lib/mail/surface-colors.
 */

import { SettingsGroup, SettingsHeading, SettingsRow, SettingsStackedRow } from "@/components/mail/settings-ui";
import { SURFACE_LABEL, SurfaceColorPicker, SurfaceColorReset } from "@/components/mail/surface-color-picker";
import { useMailT } from "@/lib/mail/i18n";
import { SURFACES, resetSurfaceColors } from "@/lib/mail/surface-colors";
import { useSurfaceColors } from "@/lib/mail/use-surface-colors";

export function SurfaceColorsSetting() {
  const t = useMailT();
  const colors = useSurfaceColors();
  const anySet = SURFACES.some((s) => colors[s]);
  return (
    <>
      <SettingsHeading className="mt-6">{t("colours")}</SettingsHeading>
      <p className="mb-2 text-xs text-stone-500">{t("coloursHint")}</p>
      <SettingsGroup>
        {SURFACES.map((surface) => (
          <SettingsStackedRow
            key={surface}
            label={
              <span className="flex items-baseline justify-between gap-2">
                {t(SURFACE_LABEL[surface])}
                <SurfaceColorReset surface={surface} />
              </span>
            }
          >
            <SurfaceColorPicker surface={surface} />
          </SettingsStackedRow>
        ))}
        {anySet ? (
          <SettingsRow
            label={<span className="text-teal-700">{t("coloursResetAll")}</span>}
            onClick={resetSurfaceColors}
          />
        ) : null}
      </SettingsGroup>
    </>
  );
}
