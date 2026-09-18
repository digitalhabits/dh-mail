# Move tokens to the data-protection keychain

Status: planned, not started. Written 2026-08-23.

## The problem

Tokens live in the macOS **login keychain** (`keyring` crate, `apple-native`
feature, service `org.digitalhabits.mail`). That keychain decides access per
item, per app signature, and asks the user with a password dialog when the
app that reads an item is not the app that made it.

This bites in three ways:

1. A debug build is signed ad-hoc, so every rebuild is a new app. Fixed on
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

## The change

1. **Entitlement.** Add to both apps' `Entitlements.plist`:
   `keychain-access-groups` = `["JD647S9RT6.org.digitalhabits.mail"]`.
   Both apps share the group, so one mailbox connected anywhere works
   everywhere, with no dialog.
2. **Provisioning profile.** On macOS the entitlement is restricted for
   Developer ID apps: the bundle must embed a Developer ID provisioning
   profile (`embedded.provisionprofile`) that grants it, or the app will not
   launch. Make one per app in the developer portal (type: Developer ID),
   add the profile to `bundle.macOS.providerShortName` / Tauri's
   `macOS.provisioningProfile`, and keep it in CI secrets. Dev builds need
   it too — extend `sign-dev.sh` to pass `--entitlements`.
3. **Vault code.** `keyring`'s `apple-native` backend uses the legacy
   keychain and has no switch for this. Replace `KeychainVault` in `db.rs`
   with direct `security-framework` calls (already a dependency, 2.11):
   `ItemAddOptions` / `ItemSearchOptions` with
   `set_use_data_protection_keychain(true)`, `kSecAttrAccessGroup` set to
   the group, `kSecAttrAccessible` = after-first-unlock. Same
   `TokenVault` trait, so `CachedVault` and all tests stay.
   `planner.rs` uses the same entry type and moves with it.
4. **Migration.** On first launch of the new build: for each account row,
   read the legacy item (this may prompt, once — say so in the UI), write it
   to the new keychain, delete the legacy item. Log what moved. Keep
   `KEYCHAIN_SERVICE` as the legacy name for this step.
5. **Windows.** Unchanged: Credential Manager has no such dialog.

## Check before starting

- The restricted-entitlement claim in step 2 is from memory of Apple's
  docs. Verify with a signed test build before making profiles.
- Confirm `security-framework` 2.11 exposes
  `set_use_data_protection_keychain`; otherwise bump the crate.

## Size

Two to three days, most of it provisioning and the migration path, plus a
tester on a clean Mac.
