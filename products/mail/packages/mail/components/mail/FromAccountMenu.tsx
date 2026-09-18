"use client";

/**
 * Which address the mail leaves from.
 *
 * Both composers used a native `<select>`, which the operating system draws
 * itself: a menu in the platform's colours, with the platform's blue on the
 * chosen line, in the middle of an interface that draws every other menu in
 * its own. This is the same menu as the rest of the mail client — the shell
 * theme, the navy of a folder that is open on the address in use.
 *
 * The trigger is a button, so it can still be focused and reached by Tab
 * the way the select it replaced was.
 */

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const FromAccountMenu = React.forwardRef<
  HTMLButtonElement,
  {
    /** The address in use. */
    value: string;
    /** Every address this person can send from. */
    accounts: string[];
    onChange: (account: string) => void;
    /**
     * "inline" is the line above the reply box, where the address is one
     * word in a sentence. "row" is a form row in the compose window, where
     * it fills the width beside its label.
     */
    variant?: "inline" | "row";
    label?: string;
    /**
     * Offer to keep the address that gets picked, the way the calendar card
     * offers to keep where an invite goes. Left out where the choice belongs
     * to the message rather than the reader — a reply is answered from the
     * address it was sent to, so there is nothing there to remember.
     */
    remember?: {
      checked: boolean;
      onChange: (next: boolean) => void;
      label: string;
    };
  }
>(function FromAccountMenu(
  { value, accounts, onChange, variant = "inline", label = "Send from", remember },
  ref
) {
  const [open, setOpen] = React.useState(false);
  /** Which row the arrow keys are on. The one in use, to start. */
  const [active, setActive] = React.useState(0);
  const rowsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, accounts.indexOf(value)));
  }, [open, accounts, value]);

  /** Arrow keys move the caret down the list, and take focus with them. */
  const step = (by: number) => {
    const next = (active + by + accounts.length) % accounts.length;
    setActive(next);
    rowsRef.current[next]?.focus();
  };

  const pick = (account: string) => {
    setOpen(false);
    if (account !== value) onChange(account);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          /* A down arrow is what a closed menu is asking for, and the
             chevron on the face of this one says so. Tabbing here from the
             subject and pressing it was doing nothing at all.

             The press is stopped as well as answered. The mail list reads
             the arrows from the window, and it counts a control as busy
             only if it is an input or a text box — so without this, Down
             opened the next message behind the composer instead. */
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "inline-flex cursor-pointer items-center gap-0.5 rounded outline-none",
            /* Loud enough to find. Tab moves through From on the way to the
               recipients, and a ring at two fifths of a teal was not
               telling anybody where they had landed. */
            "focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1",
            variant === "inline"
              ? "text-xs text-stone-700"
              : "min-w-0 flex-1 justify-between py-0.5 text-stone-800"
          )}
        >
          <span className="truncate">{value}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "shrink-0 text-stone-400",
              variant === "inline" ? "h-3 w-3" : "h-4 w-4"
            )}
          />
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        align="start"
        className="w-auto min-w-[14rem] max-w-[22rem] p-1"
        /* Enter and Escape need nothing here: the row the keys are on
           holds the focus, so Enter is its own click, and Radix closes on
           Escape. */
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          step(event.key === "ArrowDown" ? 1 : -1);
        }}
      >
        {accounts.map((account, index) => {
          const chosen = account === value;
          return (
            <button
              key={account}
              type="button"
              ref={(node) => {
                rowsRef.current[index] = node;
              }}
              /* The whole list is one control, so only the row the keys
                 are on is in the tab order — Tab leaves the menu rather
                 than walking down it. */
              tabIndex={index === active ? 0 : -1}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
                chosen
                  ? // The navy a folder wears while it is the one open.
                    // This is the same kind of answer: of these, this one.
                    "bg-[var(--mail-chrome-pinned)] font-semibold text-[var(--mail-chrome-pinned-fg)]"
                  : "text-stone-800 hover:bg-[var(--mail-chrome-hover)]",
                // Where the arrow keys are, on a row that is not the
                // chosen one — otherwise the keys move with nothing to
                // show for it.
                !chosen && index === active && "bg-[var(--mail-chrome-hover)]"
              )}
              onClick={() => pick(account)}
            >
              <Check
                aria-hidden
                className={cn("h-3.5 w-3.5 shrink-0", !chosen && "opacity-0")}
              />
              <span className="truncate">{account}</span>
            </button>
          );
        })}
        {/* Below the addresses, as on the calendar card: the tick is about
            the pick that is coming, so it has to be readable before one is
            made. Ticked, the next address chosen becomes the one new
            messages open on. */}
        {remember ? (
          <>
            <div className="mx-1.5 my-1 border-t border-stone-100" />
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-100">
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-700"
                checked={remember.checked}
                onChange={(event) => remember.onChange(event.target.checked)}
              />
              {remember.label}
            </label>
          </>
        ) : null}
      </MailPopoverContent>
    </Popover>
  );
});
