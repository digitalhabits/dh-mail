# Security and privacy

Digital Habits: Mail is a desktop app for Mac and Windows that reads your
mail directly from Gmail or Outlook. This page says what it asks for, where
it keeps things, and what leaves the machine — with the file to read for
each, so none of it has to be taken on trust.

It describes the **standalone app**, the one distributed as a `.dmg` or a
Windows installer.

## What leaves your machine

Your mail goes between your computer and your provider, and nowhere else.
There is no server of ours in the path — nothing to run, nothing to breach,
and no copy of your mail anywhere we could read it.

The app talks to these hosts:

| Host | What for | Where |
| --- | --- | --- |
| `imap.gmail.com` | Reading Gmail, and filing, archiving and deleting | [`sync.rs`](/products/mail/crates/mail-native/src/sync.rs), [`imap.rs`](/products/mail/crates/mail-native/src/imap.rs) |
| `smtp.gmail.com` | Sending Gmail | [`smtp.rs`](/products/mail/crates/mail-native/src/smtp.rs) |
| `gmail.googleapis.com` | Out-of-office reply, the send-as name, and a mailbox whose local copy is not yet complete | [`lib/gmail/api.ts`](/products/mail/packages/mail/lib/gmail/api.ts) |
| `people.googleapis.com` | Google Contacts, for the address book | [`contact-sources.ts`](/products/mail/packages/mail/lib/mail/contact-sources.ts) |
| `graph.microsoft.com` | Outlook: mail, contacts and settings | [`lib/outlook/api.ts`](/products/mail/packages/mail/lib/outlook/api.ts) |
| `accounts.google.com`, `oauth2.googleapis.com`, `login.microsoftonline.com` | Sign-in, and every token refresh after it | [`oauth.rs`](/products/mail/crates/mail-native/src/oauth.rs), [`oauth-config.ts`](/apps/mail/src/oauth-config.ts) |
| Whatever host a sender put an image on | Remote images in HTML mail — see "Reading a message safely" below. On by default; off in Settings | [`images.rs`](/products/mail/crates/mail-native/src/images.rs) |

That is the whole list. Links in mail, calendar invites and the Help menu
open in your browser, not in the app.

**There is no analytics, no crash reporting, no telemetry and no update
check.** Nothing counts what you do or reports it anywhere. You can check
this: there is no analytics SDK in the dependency lists
(`apps/mail/package.json`, `apps/mail/src-tauri/Cargo.toml`,
`products/mail/crates/mail-native/Cargo.toml`), and nothing in
`apps/mail/src`, `apps/mail/lib`, `packages/shared`,
`products/mail/packages/mail` or `products/mail/crates/mail-native/src`
contacts any host but the ones above.

## What it asks your provider for

### Google

| Scope | Why |
| --- | --- |
| `https://mail.google.com/` | The full-mailbox scope. It is the only scope Gmail's IMAP and SMTP servers accept, and the app reads and sends over IMAP and SMTP so that a local copy of the mailbox can be kept without a request budget. Google describes it as read, compose, send and permanently delete. The only thing the app deletes for good is a draft you discard ([`actions.rs`](/products/mail/crates/mail-native/src/actions.rs)); mail goes to Trash, and Gmail empties Trash on its own schedule. |
| `openid`, `email` | Sign-in only: so Google returns an ID token naming the account. Added in [`connect-mailbox.ts`](/apps/mail/src/connect-mailbox.ts). |
| `gmail.settings.basic` | Read and **set** your out-of-office reply. Setting it accepts only this scope. The same scope reads the name Gmail puts on mail you send; the app only reads that, never changes it. |
| `contacts.readonly` | Read your Google Contacts, so a name completes to an address |

Not requested: `gmail.modify` and `gmail.send`, which the full-mailbox scope
already contains; nor Drive, Calendar, Docs, or any scope outside mail and
contacts.

### Microsoft

`User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Contacts.Read`,
`MailboxSettings.ReadWrite`, plus `openid`, `profile`, `email` and
`offline_access` for sign-in and refresh.

Both lists are in [`oauth-config.ts`](/apps/mail/src/oauth-config.ts);
[`connect-mailbox.ts`](/apps/mail/src/connect-mailbox.ts) adds `openid` and
`email` to the Google request. Nothing else asks for a scope.

## Where things are kept

**Refresh tokens go in the operating system's credential store**, not in
the app's own files — the macOS keychain, or Windows Credential Manager —
under the service `org.digitalhabits.mail`. See
[`secrets.rs`](/products/mail/crates/mail-native/src/secrets.rs). The
database holds no token, so a copy of it cannot be used to sign in as you.

On a Mac, a build that carries a provisioning profile uses the
data-protection keychain, where access is decided by the app's entitlement
and macOS never asks the user. A build without one uses the login keychain,
where macOS may ask once per item with a password dialog — choose "Always
Allow". See [`KEYCHAIN.md`](/products/mail/crates/mail-native/KEYCHAIN.md).

**Mail is kept in a local SQLite file**, `mail.sqlite3`, in the app's data
directory (`database_path` in
[`db.rs`](/products/mail/crates/mail-native/src/db.rs)). It holds a copy of
every message's headers, the bodies of recent mail and of mail you have
opened, and your contacts. Attachments are fetched only when you open them,
and are not kept; one you save goes to your Downloads folder. The file is
not encrypted: anyone who can read your user account's files can read the
mail in it, as with Apple Mail or Outlook.

Disconnecting an account in Settings removes its token from the credential
store and its messages, bodies and sync state from the file
([`db.rs`](/products/mail/crates/mail-native/src/db.rs) `accounts_remove`,
[`messages.rs`](/products/mail/crates/mail-native/src/messages.rs)
`messages_clear_account`). A few smaller tables — contacts, snoozes, queued
actions, the outbox — keep their rows until the app's data directory is
deleted, which removes everything.

**Settings stay on the machine** — in `localStorage` for the interface, and
in the SQLite file for accounts. `localStorage` also holds a cache of the
thread list (senders, subjects, snippets) so the list draws before the
database answers ([`list-cache.ts`](/products/mail/packages/mail/lib/mail/list-cache.ts)).

**A log file** in the operating system's log folder records what the sync
worker did. It names the account, and for mail you send, the subject and
the recipients. It never contains a message body.

## How sign-in works

The app opens your browser, you sign in with Google or Microsoft, and the
answer comes back to a loopback listener on `127.0.0.1` — see
[`oauth.rs`](/products/mail/crates/mail-native/src/oauth.rs) and
[`connect-mailbox.ts`](/apps/mail/src/connect-mailbox.ts).

**You never type your mail password into this app.** It never sees one.

The flow uses PKCE. The Google client secret is compiled into the app, which
Google documents as not confidential for an installed app — PKCE is the
protection, not the secret.

## Reading a message safely

HTML mail is shown in an iframe of its own, with a Content-Security-Policy
that lets no script run except one hash-pinned helper of ours, after the
HTML has been stripped of scripts, forms, embeds and event handlers. The
iframe keeps the sender's CSS away from the app — see
[`EmailHtmlView.tsx`](/products/mail/packages/mail/components/mail/EmailHtmlView.tsx).

**Remote images load by default**, as they do in Apple Mail and Outlook. An
image fetched from a sender's server can tell them that you opened their
mail, and roughly where you are. We accept that trade so mail looks the way
it was sent. To change this behaviour, turn off "Load images by default" in
Settings. The app then blocks remote images, and you allow them per sender.
Pictures carried inside the message are always shown, because fetching
those tells nobody anything. A remote image is fetched by the app itself,
with no cookies and no referrer, never by the page — see
[`images.rs`](/products/mail/crates/mail-native/src/images.rs).

## Checking the app you install

**Mac.** Every release is signed with an Apple Developer ID and notarised by
Apple — both the app and the disk image, because Gatekeeper judges the image
you open. To check a copy before installing it:

```bash
spctl -a -vvv -t install "Digital Habits Mail_<version>_universal.dmg"
```

`accepted` and `source=Notarized Developer ID` mean it is the build we
signed.

**Windows.** Every installer is signed with Azure Trusted Signing. To check
a copy, in PowerShell:

```
Get-AuthenticodeSignature .\Digital-Habits-Mail_<version>_x64-setup.exe |
  Format-List Status, @{n='Subject';e={$_.SignerCertificate.Subject}}
```

`Status: Valid` and a subject of `CN=Reduce Digital Distraction Ltd` mean it
is the build we signed. The Microsoft Store copy is re-signed by Microsoft
and lists `Centre for Digital Habits` as the publisher; both names are ours.

The build writes a SHA-256 checksum beside every installer, and we
publish it with the download, so you can confirm the file you downloaded
is the file we built.

The version the app is running is shown in **Settings** on both platforms,
and in the **Help** menu on a Mac, so a report can say which build it came
from.

## This repository

The code here is a snapshot of each release, exported whole from the private
repository the app is developed in. One commit is one version. Releases are
tagged `mail-v<version>`, so `git diff mail-v0.3.3 mail-v0.3.4` shows
everything that changed between two builds.

## Reporting something

Please open an issue: <https://github.com/digitalhabits/dh-mail/issues>.
For anything you would rather not post in public, write to
team@digitalhabits.org.
