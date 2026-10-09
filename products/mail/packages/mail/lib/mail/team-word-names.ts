/**
 * The names of the words that a build can add to the interface.
 *
 * Each name is a place in the interface that can show a word of the build's
 * own. Shared code asks for one with `teamWord` from `@/lib/mail/i18n-team`.
 * The public app answers null for every name, and the code that asks shows
 * its own word, or nothing.
 */
export type TeamWordName =
  | "peopleTab"
  | "peopleEmpty"
  | "addToPeople"
  | "searchFromPeople"
  | "recordsSource"
  | "editRecords"
  | "recordsExplain"
  | "recordsBadge"
  | "sendAndUpdateRecords"
  | "updateRecords";
