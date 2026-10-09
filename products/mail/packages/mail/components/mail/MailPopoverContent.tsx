"use client";

/**
 * Popover content that carries the mail theme.
 *
 * Radix puts popover content in a portal on `<body>`, outside `.mail-shell`.
 * The shell tokens therefore do not reach it, and a menu stayed light while
 * the rest of the app was dark. This copies the shell class and the resolved
 * theme onto the content, so the same tokens apply inside the portal.
 *
 * It also closes when a message is clicked. An HTML message is an iframe, and
 * a click inside one never reaches this document, so Radix does not see it as
 * a click outside: the snooze menu stayed open over the thread until the
 * sidebar was clicked. Focus moving into an iframe blurs this window, so on
 * that blur the menu closes through Radix's own Close, which runs the same
 * onOpenChange(false) as any other way out.
 *
 * Use this instead of `PopoverContent` for every menu in the mail interface.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMailColorMode } from "@/lib/mail/theme";

export const MailPopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  React.ComponentPropsWithoutRef<typeof PopoverContent>
>(({ className, children, ...props }, ref) => {
  const colorMode = useMailColorMode();
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    const onWindowBlur = () => {
      // The focused element is known once the blur has finished.
      window.setTimeout(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLIFrameElement)) return; // another app, not a message
        if (contentRef.current?.contains(focused)) return; // a frame inside the menu itself
        closeRef.current?.click();
      }, 0);
    };
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  return (
    <PopoverContent
      ref={setRefs}
      data-theme={colorMode}
      className={cn("mail-shell mail-popover", className)}
      {...props}
    >
      {children}
      <PopoverPrimitive.Close ref={closeRef} hidden tabIndex={-1} aria-hidden />
    </PopoverContent>
  );
});
MailPopoverContent.displayName = "MailPopoverContent";
