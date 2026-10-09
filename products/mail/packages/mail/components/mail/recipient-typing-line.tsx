import * as React from "react";

/**
 * In the inline field, the box to type in and the lists button, as one line.
 * Apart, the box took a line of its own beside wide chips, and the button
 * fell to a third line, alone in the middle of the field.
 */
export function TypingLine({ inline, children }: { inline: boolean; children: React.ReactNode }) {
  if (!inline) return <>{children}</>;
  return <span className="flex min-w-[16ch] flex-1 items-center gap-1.5">{children}</span>;
}
