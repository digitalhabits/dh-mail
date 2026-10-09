"use client";

/**
 * Mail's own question, asked before macOS asks its one.
 *
 * See `lib/mail/mac-contacts-ask` for why this exists rather than a direct
 * call to the system prompt. "Not now" is a real answer here and costs
 * nothing, which is what lets the offer be made at all.
 *
 * It appears once a mailbox is connected, because completing an address means
 * nothing before there is mail to write.
 *
 * A dialog, not a plain overlay. A mailbox is usually connected from
 * Settings, which is a modal popover: it blocks clicks outside itself, so an
 * overlay drawn above it could be seen but not clicked until Settings was
 * shut. A dialog opened over a modal layer is the top layer, and takes the
 * clicks and the keyboard.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";

import { Button } from "@/components/ui/button";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  macAsksLeft,
  noteMacAsked,
  stopAskingForMacContacts,
} from "@/lib/mail/mac-contacts-ask";
import {
  macContactsAuthorization,
  macContactsRequestAccess,
} from "@/lib/native-shell";

export function MacContactsAskCard({
  /** Bump to consider asking again — a mailbox arrived, or a composer opened. */
  trigger,
  onGranted,
}: {
  trigger: number;
  onGranted: () => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [asking, setAsking] = React.useState(false);

  React.useEffect(() => {
    if (!trigger) return;
    let alive = true;
    void (async () => {
      if (!macAsksLeft()) return;
      // Only worth asking while macOS has no answer of its own. Once it has
      // one, the Contact sources panel is the only place that can change it.
      if ((await macContactsAuthorization()) !== "notDetermined") return;
      if (!alive) return;
      noteMacAsked();
      setOpen(true);
    })();
    return () => {
      alive = false;
    };
  }, [trigger]);

  const allow = async () => {
    setAsking(true);
    try {
      const status = await macContactsRequestAccess();
      if (status === "authorized" || status === "limited") {
        // macOS will not ask again, and now it does not need to.
        stopAskingForMacContacts();
        setOpen(false);
        // Read the book now. Saying yes and seeing nothing change reads as a
        // yes that did not take.
        try {
          await apiJson("/api/mail/contact-sources/sync", { method: "POST" });
        } catch (err) {
          console.warn("[mail] contact sync after allow failed:", err);
        }
        onGranted();
        return;
      }
      stopAskingForMacContacts();
      setOpen(false);
      toast.error(mailSay("allowContactsLater"));
    } finally {
      setAsking(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Escape or a click beside it is "Not now". Not while macOS asks.
        if (!next && !asking) setOpen(false);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-stone-900/30" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%-3rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-200 bg-white p-5 shadow-xl">
          <DialogPrimitive.Title className="text-base font-semibold text-stone-900">
            {t("macContactsAsk2")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-stone-600">
            Mail can suggest names and addresses from the Contacts app while you
            write. It reads them only. It never changes a contact, and nothing
            leaves this Mac.
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={asking}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("notNow")}
            </Button>
            <Button
              type="button"
              disabled={asking}
              onClick={() => void allow()}
            >
              {asking ? t("waitingForMacOs") : t("allow")}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
