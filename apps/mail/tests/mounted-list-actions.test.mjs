/**
 * What MailPage does with the rows of its list.
 *
 * Mounted as mounted-smoke is, against happy-dom and the transport seam.
 * These walks guard the parts of MailPage.tsx that are about to move into
 * hooks: the Undo stack, the selection, the next row after a removal, and
 * the window keys. Each walk must pass before a move and after it.
 *
 * - Archive from the reader: the request goes, the row leaves, and the next
 *   row opens. Command+Z brings the row back and asks the server to undo.
 * - Delete from the reader, then Command+Z: the same, through Trash.
 * - Two archives, then the Undo on the first toast: that toast takes back
 *   its own archive, not the newest one.
 * - Down and Up open the next and the previous row.
 * - A shift-click selects a range. Archive on the selection sends one
 *   request per thread, and opens the row after the range. One Command+Z
 *   brings them all back.
 * - Command-click adds a row and takes it out. Escape clears the
 *   selection. Backspace deletes it and opens the row after it.
 * - In the people view, Archive all in the person pane archives each of
 *   that person's threads, with one toast. Command+Z brings them back.
 * - Command+N opens a new message.
 * - Option+Command+F puts the focus in the search field, Option+Command+L
 *   expands the list and gives the pane back, and Down and Up walk the
 *   people in the people view.
 * - Edit as new from the row menu stores a copy with no recipients and
 *   opens a composer on it.
 * - A forward asked for from a chat pop-out opens the thread and a forward.
 * - Edit as new asked for from a chat pop-out opens a composer on a copy.
 * - In the people view, the person menu pins a person to the top and
 *   unpins, Snooze… opens the snooze times, and a search keeps only the
 *   people it finds.
 * - The open thread's keys: Command+U unread and read, Shift+Command+I pin
 *   and unpin, Command+K snooze (and Command+Z), Shift+Command+M to a
 *   folder (and Command+Z) or to Junk.
 * - Delete all for a person asks first, and Command+Z brings it back.
 * - A reply the provider is holding stands at the end of its thread.
 * - A pinned thread archived or deleted loses its pin, and Command+Z puts
 *   both back; an archive the provider refuses keeps the row and its pin.
 * - In the people view, archiving the last conversation of the open
 *   person opens the next person.
 * - In Trash: Restore, and Delete forever, which asks first, waits out
 *   its count, and deletes nothing when Undo is pressed inside it.
 * - An auto-reply that is on: after its pause the page says so, Manage
 *   opens the dialog, and a save there that turns it off takes the line
 *   away. (End, in the accounts panel, is not walked.)
 * - A held message that failed: the Outbox shows it, and Try again sends
 *   it and reads the Outbox again.
 * - Sync reads the list again, a new conversation arrives, and a toast
 *   says how many came in.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-list-actions.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
