/**
 * The address field, mounted against happy-dom with invented contacts.
 *
 * It guards the field's split into RecipientField.tsx (the field),
 * recipient-suggestions.ts (what it suggests) and recipient-lists.tsx
 * (contact lists):
 *
 * - A typed address and a comma make a chip; so does Enter.
 * - A name typed finds the contact, and Enter takes it with its name; it
 *   is not offered again once it is on the message.
 * - The arrow keys move down the suggestions.
 * - A list's name finds the list, and it becomes one chip with its people.
 * - Your own mailbox is suggested before the contacts are read.
 * - A pasted run of addresses becomes chips at once.
 * - Backspace in an empty box takes the last chip; a chip's own button
 *   takes that chip.
 * - Two people or more offer Save as list.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-recipient-field.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
