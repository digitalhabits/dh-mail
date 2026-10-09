/**
 * The closed set of folder views, which used to be written twice.
 *
 * The interface asks for a view by name; the transport turns that name back
 * into a view for the core. A name in neither list is not refused — it falls
 * through to undefined, and the core lists the inbox. So Archived, added to
 * the first list and not the second, lit the rail, said "Search Archived",
 * and served the inbox.
 */

import assert from "node:assert/strict";

import { MAIL_FOLDER_VIEWS, asMailFolderView } from "@/lib/mail/folder-views";

/** Everything the interface asks for survives the trip to the core. */
{
  for (const view of MAIL_FOLDER_VIEWS) {
    assert.equal(asMailFolderView(view), view, `${view} is asked for but dropped`);
  }
  assert.ok(MAIL_FOLDER_VIEWS.includes("archived"));
}

/** Anything else is no view at all, and the core will serve the inbox. */
{
  for (const raw of ["inbox", "drafts", "snoozed", "Archive", "", "  ", null, undefined]) {
    assert.equal(
      asMailFolderView(raw),
      undefined,
      `${JSON.stringify(raw)} became a folder view`
    );
  }
}

/** Spacing around a name is not a different name. */
{
  assert.equal(asMailFolderView(" archived "), "archived");
}

console.log("folder-views: ok");
