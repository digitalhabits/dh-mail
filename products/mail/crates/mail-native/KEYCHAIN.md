# Tokens and the two macOS keychains

Code: [`src/secrets.rs`](src/secrets.rs). Written 2026-08-23.

## The problem

Tokens used to live only in the macOS **login keychain** (`keyring` crate).
That keychain decides access per item, per app signature, and asks the user
with a password dialog when the app that reads an item is not the app that
made it. This bit in three ways:

1. A debug build is signed ad-hoc, so every rebuild was a new app. Fixed on
   both apps with `sign-dev.sh`.
2. The planner (`org.digitalhabits.plan`) reads items the mail app
   (`org.digitalhabits.mail`) made. One dialog per mailbox, even in release.
3. A release user still sees dialogs if an item was made by an earlier
   signature (pre-0.3.4 builds, or a dev build), and on recent macOS
   "Always Allow" often does not hold for such items. A tester reported
   this on the 0.8.3 DMG.

Apple's answer (TN3137) is the **data-protection keychain**: access is
decided by the `keychain-access-groups` entitlement, and this dialog does not
exist there.

## What the code does now

`Secrets::open` probes the data-protection keychain once at startup.

- Entitled build: tokens go to the data-protection keychain, access group
  `JD647S9RT6.org.digitalhabits.mail`, shared by the Planner, Mail, and Mail
  (Internal). An item not found there is looked for in the login keychain,
  moved across, and removed there — one last dialog at most, per item.
- Unentitled build (`errSecMissingEntitlement`, -34018): the login keychain,
  as before. Dev builds are always this: a bare binary cannot carry a
  profile.
- Windows: Credential Manager through `keyring`, unchanged.

The log line at startup says which: `secrets: data-protection keychain` or
`secrets: login keychain (...)`.

## What is verified, and what is not

Verified on this Mac: the probe gets -34018 in an unentitled process and the
code falls back (test `the_store_is_chosen_without_crashing`); a Developer ID
binary that *claims* the entitlement with no profile is killed at launch
(SIGKILL), which is why the entitlement is opt-in below; both apps build;
the 47 store tests pass against the unchanged `TokenVault` trait.

**Not yet verified: the data-protection read/write/delete path itself.** It
needs a build with a provisioning profile, and none exists yet. First thing
to do once one does: connect a mailbox, quit, relaunch, and confirm no dialog
and the `data-protection keychain` log line.

## Turning it on: the provisioning profiles

`keychain-access-groups` is a restricted entitlement. A Developer ID app
must embed a profile that grants it, or macOS kills the app at launch.

1. In the Apple Developer portal (team JD647S9RT6), make a **Developer ID**
   provisioning profile for each app ID:
   `org.digitalhabits.mail`, `org.digitalhabits.mail.internal`,
   `org.digitalhabits.plan`. Register the app IDs first if they are not
   there. Developer ID profiles grant `keychain-access-groups` for
   `JD647S9RT6.*`, which covers the shared group.
2. Save each as `src-tauri/embedded.provisionprofile` in the app it is for
   (`apps/mail/src-tauri/` for both mail flavors — swap the file when
   building the other flavor; `src-tauri/` for the planner). Git ignores
   the file.
3. Build as usual. `build-standalone.sh` and `build-mac-signed.sh` see the
   file and add `--config src-tauri/tauri.keychain[.internal].conf.json`,
   which switches to `Entitlements.keychain[.internal].plist` and copies the
   profile into the bundle. Without the file nothing changes.
4. Check: `codesign -d --entitlements - "<app>"` lists the group, and
   `ls "<app>/Contents/embedded.provisionprofile"` exists.

The entitlement plists name `com.apple.application-identifier` per app, so
they must match the profile's app ID — that is why there are three.

## Side effects to know

- A dev build and a release build on the same Mac no longer share tokens
  once the release build has migrated them. Reconnect the mailbox in the
  dev build.
- The migration reads the login keychain item once, which may show the old
  dialog one last time. Tell testers to choose "Always Allow" or just
  "Allow"; either way it does not come back.
