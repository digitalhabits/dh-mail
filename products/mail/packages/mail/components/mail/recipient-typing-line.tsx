import * as React from "react";

/**
 * In the inline field, the box to type in and the lists button, as one line.
 * Apart, the box took a line of its own beside wide chips, and the button
 * fell to a third line, alone in the middle of the field.
 *
 * At least 16ch wide, but never wider than the field. In a narrow composer
 * the field can be less than 16ch; a plain 16ch minimum then pushed the box
 * out of the field and its placeholder ran under Cc and Bcc.
 */
export function TypingLine({ inline, children }: { inline: boolean; children: React.ReactNode }) {
  if (!inline) return <>{children}</>;
  return <span className="flex min-w-[min(16ch,100%)] flex-1 items-center gap-1.5">{children}</span>;
}
