"use client";

import * as React from "react";

import { EmojiPickerButton } from "@/components/ui/EmojiPicker";
import {
  COMPOSER_TOOLBAR_BUTTON,
  TextStyleMenu,
} from "@/components/mail/TextStyleMenu";
import { useMailT } from "@/lib/mail/i18n";
import { FORMAT_SHORTCUTS } from "@/lib/mail/shortcuts";
import type { RichTextEditorHandle } from "@/components/ui/RichTextEditor";

/**
 * The formatting row a mail message is written with.
 *
 * Quill takes its toolbar by id — the element has to be on the page before
 * the editor mounts — so the surface renders this where its own layout wants
 * it and hands the id to `RichTextEditor`. The composer puts it in the footer
 * beside Send; the out-of-office puts it at the top of its card.
 *
 * One row for all three, because a message is a message: whatever is being
 * written, the same words are bold the same way. It stood written out twice,
 * once in the composer and once in the reply, identical but for the name of
 * the handle — and the out-of-office had Quill's own bar instead, with a
 * different set of buttons in a different order.
 *
 * The emoji picker and the Aa menu carry no `ql-` class, so Quill passes over
 * both: they are in the row for the look of it, and reach the editor through
 * the handle.
 */
export function ComposerToolbar({
  id,
  editorHandle,
}: {
  /** Matches the `toolbarId` given to the editor this row drives. */
  id: string;
  editorHandle: React.MutableRefObject<RichTextEditorHandle | null>;
}) {
  const t = useMailT();
  return (
    <div id={id} className="mail-composer-toolbar">
      <span className="ql-formats">
        <EmojiPickerButton
          className={COMPOSER_TOOLBAR_BUTTON}
          onPick={(emoji) => editorHandle.current?.insertText(emoji)}
        />
        <button
          className="ql-bold"
          aria-label={t("bold")}
          title={`${t("bold")} (${FORMAT_SHORTCUTS.bold})`}
        />
        <button
          className="ql-italic"
          aria-label={t("italic")}
          title={`${t("italic")} (${FORMAT_SHORTCUTS.italic})`}
        />
        <button
          className="ql-underline"
          aria-label={t("underline")}
          title={`${t("underline")} (${FORMAT_SHORTCUTS.underline})`}
        />
        <button
          className="ql-link"
          aria-label={t("link")}
          title={`${t("link")} (${FORMAT_SHORTCUTS.link})`}
        />
        <TextStyleMenu
          editorHandle={editorHandle}
          className={COMPOSER_TOOLBAR_BUTTON}
        />
      </span>
    </div>
  );
}
