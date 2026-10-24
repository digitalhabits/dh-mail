/**
 * Every name that the Mail interface uses in localStorage and sessionStorage.
 *
 * Each key is defined here and nowhere else. Modules import the name from
 * this file. The test `storage-keys` in apps/mail/tests fails when a key is
 * defined in another file.
 *
 * Do not change a stored string. The browser finds the value by the exact
 * name, so a renamed key loses the setting of each reader. The names use
 * five old naming schemes. Keep them as they are.
 *
 * To rename a key, add a step to `lib/mail/storage-upgrade.ts`. The step
 * copies the old value to the new key, then removes the old key.
 *
 * Each comment tells:
 * - what the value holds,
 * - local (localStorage) or session (sessionStorage),
 * - for a prefix: what the code adds after it (per account, per thread).
 *
 * Names in the native settings store (`mailStore().settings`) are not here.
 * They are not browser storage. Examples: `mail_signature`,
 * `mail_sender_name`, `mail_text_style`, `dh-mail-exchange-folders:`.
 */

// ---------------------------------------------------------------------------
// App shell and upgrade
// ---------------------------------------------------------------------------

/** The storage upgrade version. The last step that `storage-upgrade.ts` ran. Local. */
export const STORAGE_VERSION_KEY = "dh-mail-storage-version";
/** The licence revision that the reader accepted, and when. Local. */
export const EULA_KEY = "mail_eula";
/** The usage count: the last day it was sent, and the install id. Local. */
export const USAGE_PING_STATE_KEY = "mail_usage_ping";
/** "0" when the reader turned off the usage count. Local. */
export const USAGE_PING_ENABLED_KEY = "mail_usage_ping_enabled";

// ---------------------------------------------------------------------------
// Language, theme and scale
// ---------------------------------------------------------------------------

/** The interface language that the reader chose. Local. */
export const MAIL_LANG_KEY = "redd-plan-mail-lang";
/** Light, dark or system. Local. */
export const MAIL_COLOR_MODE_KEY = "redd-plan-mail-color-mode";
/** The interface scale. Removed when it is 100 %. Local. */
export const MAIL_UI_SCALE_KEY = "redd-plan-mail-ui-scale";
/** The zoom of the mail pane. Local. */
export const MAIL_ZOOM_KEY = "redd-plan-mail-zoom";
/** The keyboard shortcuts that the reader changed. Local. */
export const MAIL_SHORTCUTS_KEY = "redd-plan-mail-shortcuts";
/** The resting picture and its caption. Local. */
export const MAIL_REST_KEY = "redd-plan-mail-rest";

// ---------------------------------------------------------------------------
// Layout of the window
// ---------------------------------------------------------------------------

/** Where the list sits beside the reading pane. Local. */
export const MAIL_LIST_PLACEMENT_KEY = "redd-plan-mail-list-placement";
/** "1" when the filter row is open. Local. */
export const MAIL_FILTER_ROW_KEY = "redd-plan-mail-filter-row";
/** The width of the list, in pixels. Local. */
export const MAIL_LIST_WIDTH_KEY = "redd-plan-mail-list-width";
/** The height of the list when it is above the reader, in pixels. Local. */
export const MAIL_LIST_HEIGHT_KEY = "redd-plan-mail-list-height";
/** The width of the controls column, in pixels. Local. */
export const MAIL_CONTROLS_WIDTH_KEY = "redd-plan-mail-controls-width";
/** The width of the composer, as a percent of the pane. Local. */
export const MAIL_COMPOSER_WIDTH_KEY = "redd-plan-mail-composer-width-pct";
/** The height of the composer, in pixels. Local. */
export const MAIL_COMPOSER_HEIGHT_KEY = "redd-plan-mail-composer-height-px";
/** "1" when the reader hid the list (peek mode). Local. */
export const MAIL_LIST_HIDDEN_KEY = "redd-plan-mail-list-hidden";
/** "1" when the folder rail is open. Local. */
export const FOLDER_RAIL_OPEN_KEY = "redd-plan-mail-folder-rail-open-v1";
/** The folders that are collapsed in the rail. Local. */
export const FOLDER_RAIL_COLLAPSED_KEY = "redd-plan-mail-folder-rail-collapsed-v1";
/** The mailboxes that are collapsed in the rail. Local. */
export const FOLDER_RAIL_COLLAPSED_ACCOUNTS_KEY =
  "redd-plan-mail-folder-rail-collapsed-accounts-v1";
/** The width of the folder rail, in pixels. Local. */
export const FOLDER_RAIL_WIDTH_KEY = "redd-plan-mail-folder-rail-width-v1";
/** "1" when the rail shows a count beside each folder. Local. */
export const FOLDER_COUNTS_KEY = "redd-plan-mail-folder-counts";
/** The favourite folders, for each mailbox. Local. */
export const FOLDER_FAVOURITES_KEY = "redd-plan-mail-folder-favourites-v1";
/** The width that the reader gave the message bubbles. Local. */
export const BUBBLE_WIDTH_KEY = "dh-mail-bubble-width";
/** The side to which a wide bubble grows: "left" or "right". Local. */
export const BUBBLE_SIDE_KEY = "dh-mail-bubble-grow";
/** The size of the floating compose card. Local. */
export const FLOATING_COMPOSE_SIZE_KEY = "dh-mail-floating-compose-size";
/** The size of the floating reply card. Local. */
export const FLOATING_REPLY_SIZE_KEY = "dh-mail-floating-reply-size";
/**
 * Added after a floating card's size key, for the size of the card when it
 * is centred as a dialog. Local.
 */
export const FLOATING_CARD_CENTRED_SUFFIX = ":centred";
/** Old: the place of the dragged composer. Only removed now. Local. */
export const OLD_COMPOSER_PLACE_KEY = "dh-mail-composer-place";
/** Old: the place of the dragged reply tray. Only removed now. Local. */
export const OLD_REPLY_TRAY_KEY = "dh-mail-reply-tray";

// ---------------------------------------------------------------------------
// The list, tabs and pins
// ---------------------------------------------------------------------------

/** "threads" or "people": one row per thread, or one per person. Local. */
export const MAIL_VIEW_MODE_KEY = "redd-plan-mail-view-mode";
/** "1" when the unread switch at the end of the tabs is on. Local. */
export const MAIL_UNREAD_ONLY_KEY = "redd-plan-mail-unread-only";
/** The row density of the list. Local. */
export const MAIL_LIST_DENSITY_KEY = "redd-plan-mail-list-density";
/** The tab that was open last. Local. */
export const MAIL_TAB_KEY = "redd-plan-mail-tab";
/** The order of the tabs. Local. */
export const MAIL_TAB_ORDER_KEY = "redd-plan-mail-tab-order";
/** The icon that the reader chose for each tab. Local. */
export const MAIL_TAB_ICON_KEY = "redd-plan-mail-tab-icons";
/** The hours in which each tab shows. Local. */
export const MAIL_TAB_SCHEDULE_KEY = "redd-plan-mail-tab-schedules";
/** The lists (tabs) that the reader made. Local. */
export const MAIL_CUSTOM_LISTS_KEY = "redd-plan-mail-custom-lists";
/** "0" when a search also looks in hidden mailboxes. Local. */
export const SEARCH_HIDDEN_MAILBOXES_KEY = "mail-search-hidden-mailboxes";
/**
 * The cached thread list. Prefix, per viewer: the code adds ":" and the
 * viewer id. Local.
 */
export const MAIL_THREADS_CACHE_PREFIX = "redd-plan-mail-threads-cache-v9";
/** Old page cache. Only removed now. Local. */
export const OLD_PAGE_CACHE_V2_KEY = "redd-plan-page-mail-v2";
/** Old thread list cache. Only removed now. Local. */
export const OLD_THREADS_CACHE_V7_KEY = "redd-plan-mail-threads-cache-v7";
/** Old thread list cache. Only removed now. Local and session. */
export const OLD_THREADS_CACHE_V6_KEY = "redd-plan-mail-threads-cache-v6";
/** Old thread list cache. Only removed now. Local and session. */
export const OLD_THREADS_CACHE_V5_KEY = "redd-plan-mail-threads-cache-v5";
/** The pinned threads. Local. */
export const MAIL_PINS_KEY = "redd-plan-mail-pins-v1";
/** The pinned people. Local. */
export const MAIL_PERSON_PINS_KEY = "redd-plan-mail-person-pins-v1";

// ---------------------------------------------------------------------------
// Mailboxes and accounts
// ---------------------------------------------------------------------------

/** The colour and picture of each mailbox. Local. */
export const MAIL_ACCOUNT_MARK_KEY = "redd-plan-mail-account-marks";
/** The order of the mailboxes. Local. */
export const MAIL_ACCOUNT_ORDER_KEY = "redd-plan-mail-account-order";
/** The mailbox that new mail is sent from. Local. */
export const COMPOSE_FROM_KEY = "redd-plan-mail-compose-from";
/** The mailbox that gets an Outlook draft. Local. */
export const OUTLOOK_DRAFT_ACCOUNT_KEY = "redd-plan-mail-outlook-draft-account";
/** The calendar that takes an invite: app, Google or Outlook. Local. */
export const CALENDAR_TARGET_KEY = "redd-plan-mail-calendar-target";
/** The calendar that the reader last sent diary entries to. Local. */
export const DIARY_CALENDAR_KEY = "redd-mail-diary-calendar";
/** "1" when Exchange connect also tries the known servers. Local. */
export const SEARCH_KNOWN_SERVERS_KEY = "redd-plan-mail-exchange-search-known";
/** The Outlook folders that were read again once, per mailbox and folder. Local. */
export const OUTLOOK_REREAD_KEY = "dh-mail-outlook-reread-1";
/** How many times the app offered the Mac contacts, and the answer. Local. */
export const MAC_CONTACTS_ASK_KEY = "redd-plan-mail-mac-contacts-ask";

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/** The senders whose images always load. Local. */
export const MAIL_IMAGES_SENDER_KEY = "redd-plan-mail-images-senders";
/** "1" when images load in every message. Local. */
export const MAIL_LOAD_IMAGES_KEY = "redd-plan-mail-load-images";
/** The line count after which a message gets a "show more" button. Local. */
export const READER_LINES_KEY = "redd-plan-mail-reader-lines";
/** The text size of the Reader. Local. */
export const READER_SIZE_KEY = "redd-plan-mail-reader-size";
/** The column width of the Reader, in pixels. Local. */
export const READER_WIDTH_KEY = "redd-plan-mail-reader-width";
/** "1" when the forwarded message is open in the composer. Local. */
export const FORWARD_SOURCE_OPEN_KEY = "dh-mail-forward-source-open";
/** "1" when the history of the thread is open under a reply. Local. */
export const REPLY_HISTORY_OPEN_KEY = "dh-mail-reply-history-open";

// ---------------------------------------------------------------------------
// Pause, hide and snooze
// ---------------------------------------------------------------------------

/** The pause of the mail, and until when. Local. */
export const MAIL_PAUSE_KEY = "redd-plan-mail-pause";
/** The mailboxes that are hidden, and until when. Local. */
export const MAILBOX_HIDE_KEY = "redd-plan-mail-hide";
/** The snooze options that the reader changed. Local. */
export const SNOOZE_SETTINGS_KEY = "redd-plan-mail-snooze-options";
/** The pause options that the reader changed. Local. */
export const PAUSE_OPTIONS_KEY = "redd-plan-mail-pause-options";
/** When each mailbox's inbox was last read, not paused: epoch ms by address. Local. */
export const MAIL_LAST_LIVE_READ_KEY = "dh-mail-last-live-read";
/** The missed scheduled messages that the app asked about. Session. */
export const MISSED_SCHEDULED_ASKED_KEY = "mail-missed-scheduled-asked";

// ---------------------------------------------------------------------------
// Inbox sort (triage)
// ---------------------------------------------------------------------------

/** The last choices for an inbox sort. Local. */
export const TRIAGE_OPTIONS_KEY = "dh-mail-triage-options";
/** The result of the last inbox sort. Local. */
export const TRIAGE_RESULT_KEY = "dh-mail-triage-result";

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/** The folder that attachments go to. Local. */
export const DOWNLOAD_FOLDER_KEY = "mail-download-folder";
/** The folders that were used last. Local. */
export const DOWNLOAD_RECENT_KEY = "mail-download-recent";
/** "1" when the app asks for a folder at each download. Local. */
export const DOWNLOAD_ALWAYS_ASK_KEY = "mail-download-always-ask";

// ---------------------------------------------------------------------------
// Messages between windows
// ---------------------------------------------------------------------------

/**
 * A signal: a popout sent mail. Local. Other windows read it in the
 * "storage" event.
 */
export const MAIL_POPOUT_SENT_KEY = "redd-plan-mail-popout-sent";
/** A signal: a popout asks the main window to forward a message. Local. */
export const MAIL_FORWARD_REQUEST_KEY = "redd-plan-mail-forward-request";
/** A signal: a popout asks the main window to edit a message as new. Local. */
export const MAIL_EDIT_AS_NEW_REQUEST_KEY = "redd-plan-mail-edit-as-new-request";
/** A signal: a thread changed in another window. Local. */
export const MAIL_CHANGED_KEY = "redd-plan-mail-thread-changed";
/** The threads that are open in a chat popout. Local. */
export const POPOUT_OPEN_KEY = "redd-plan-mail-popout-open";
/** Whether a long thread shows its outline rail ("0" when turned off). Local. */
export const THREAD_OUTLINE_KEY = "redd-plan-mail-thread-outline";
/**
 * The seed of a chat popout. Prefix, per thread: the code adds
 * "account|threadId". Local. Read once, then removed.
 */
export const POPOUT_SEED_PREFIX = "redd-plan-chat-popout-seed:";
/**
 * The newest message that a chat popout showed. Prefix, per thread: the
 * code adds "account|threadId". Local.
 */
export const POPOUT_SEEN_PREFIX = "redd-plan-chat-popout-seen:";
/**
 * The thread that a Reader window opens with. Prefix, per thread: the code
 * adds "account|threadId". Local, then moved to session in the new window.
 */
export const READER_HANDOFF_PREFIX = "redd-plan-mail-reader-handoff:";
/**
 * The person that a person window opens with. Prefix, per person. Local,
 * then moved to session in the new window.
 */
export const PERSON_HANDOFF_PREFIX = "redd-plan-mail-person-handoff:";
/** The person that a person window shows. Prefix, per person. Session. */
export const PERSON_WINDOW_PREFIX = "redd-plan-mail-person-window:";
