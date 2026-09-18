"use client";

import { Loader2 } from "lucide-react";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function MailListLoading({
  provider,
  onNavy,
  narrow,
}: {
  provider: string;
  onNavy: boolean;
  narrow: boolean;
}) {
  const t = useMailT();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-2 py-10 text-center",
        narrow ? "px-2" : "px-5"
      )}
    >
      <Loader2
        aria-hidden
        className={cn(
          "h-5 w-5 animate-spin",
          onNavy ? "text-white/60" : "text-stone-400"
        )}
      />
      {narrow ? null : (
        <>
          <p
            className={cn(
              "text-sm",
              onNavy ? "text-white/80" : "text-stone-600"
            )}
          >
            {t("loadingFromProvider", { provider })}
          </p>
          <p
            className={cn(
              "text-xs",
              onNavy ? "text-white/50" : "text-stone-400"
            )}
          >
            {t("loadingFolderHint")}
          </p>
        </>
      )}
    </div>
  );
}
