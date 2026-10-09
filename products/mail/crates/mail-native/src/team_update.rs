//! Self-update, for two kinds of app:
//!
//! - a team build, with the `team-updater` feature. It asks its own server
//!   (`start`), through the `team` feature's session.
//! - the public Mail app's direct downloads, the .dmg and the Windows .exe,
//!   with the `public-updater` feature. They ask the public GitHub release
//!   (`start_public`).
//!
//! A store package must not carry an updater at all: the App Store and the
//! Microsoft Store update what they installed. So the build that makes a
//! store package turns neither feature on.
//!
//! How it works:
//!
//! 1. A short while after start, and then every few hours, the app asks if
//!    there is a newer version. The public app reads `latest.json` from
//!    the newest published release, with no key: those files are public
//!    anyway. A team build asks its own server, and waits while it has no
//!    session.
//! 2. A newer version is downloaded in the background. The updater checks
//!    the download against the public key in the app's config and refuses a
//!    file that does not match. Nothing is installed yet.
//! 3. The app tells its interface (`dh-team-update-ready`). The interface
//!    shows a bar with one button; the button calls `team_update_install`,
//!    which installs and restarts the app.
//! 4. If the person quits instead, the update is installed on the way out
//!    (`install_on_exit`), and the next start is the new version.
//!
//! A failed check says nothing to the person. The app works as before, and
//! the next check tries again. A dev build never checks: it must not replace
//! itself with a release.
//!
//! The release side of the public app is the Build workflow of the public
//! repository. It writes `latest.json` into the draft release, and
//! publishing the draft is what sends the update out.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// The interface listens for this. The payload is an `UpdateInfo`.
pub const READY_EVENT: &str = "dh-team-update-ready";

/// Give the window time to load before the network is used.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
/// A new version reaches a running app within this time.
const CHECK_EVERY: Duration = Duration::from_secs(2 * 60 * 60);
/// No session yet. Try again soon: the page may be signing in.
#[cfg(feature = "team")]
const NO_SESSION_RETRY: Duration = Duration::from_secs(5 * 60);
/// The check or the download failed. Probably offline.
const ERROR_RETRY: Duration = Duration::from_secs(30 * 60);
/// A whole app is tens of megabytes. Allow for a slow network.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// The longest the restart waits for writes the window still owes.
const WRITE_DRAIN_CAP: Duration = Duration::from_secs(8);

/// What the interface shows on the bar.
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
  pub version: String,
  pub notes: Option<String>,
}

struct Ready {
  update: tauri_plugin_updater::Update,
  bytes: Vec<u8>,
}

/// A downloaded update waiting to be installed. One at most.
#[derive(Default)]
pub struct TeamUpdate(Mutex<Option<Ready>>);

/// Where an app asks for a newer version. A build has one feature or the
/// other, so one of the two is never made: that is not dead code.
#[derive(Clone, Copy)]
#[allow(dead_code)]
enum Source {
  /// The team build's own update route, for this app key.
  #[cfg(feature = "team")]
  Team(&'static str),
  /// A public manifest, `latest.json`, at this address.
  Public(&'static str),
}

/// Start checking the team build's route. `app_key` names the app to it.
/// Call from setup, after the session is in state.
#[cfg(feature = "team-updater")]
pub fn start(app: &tauri::AppHandle, app_key: &'static str) {
  run(app, Source::Team(app_key));
}

/// Start checking a public manifest. For the public app's direct
/// downloads only: never call this in a store package.
#[cfg(feature = "public-updater")]
pub fn start_public(app: &tauri::AppHandle, manifest_url: &'static str) {
  run(app, Source::Public(manifest_url));
}

fn run(app: &tauri::AppHandle, source: Source) {
  if cfg!(debug_assertions) {
    return;
  }
  if let Err(err) = app.plugin(tauri_plugin_updater::Builder::new().build()) {
    log::warn!("team update: the updater did not start: {err}");
    return;
  }
  app.manage(TeamUpdate::default());
  // A thread of its own, which mostly sleeps. Each check runs on the async
  // runtime and is waited for here.
  let app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(FIRST_CHECK_DELAY);
    loop {
      let wait = match tauri::async_runtime::block_on(check(&app, source)) {
        #[cfg(feature = "team")]
        Ok(Checked::NoSession) => NO_SESSION_RETRY,
        Ok(Checked::Done) => CHECK_EVERY,
        Err(err) => {
          log::warn!("team update: {err}");
          ERROR_RETRY
        }
      };
      std::thread::sleep(wait);
    }
  });
}

enum Checked {
  /// No session yet. A team build only.
  #[cfg(feature = "team")]
  NoSession,
  Done,
}

async fn check(app: &tauri::AppHandle, source: Source) -> Result<Checked, String> {
  let builder = match source {
    #[cfg(feature = "team")]
    Source::Team(app_key) => {
      let Some((endpoint, token)) = crate::team_session::update_endpoint(app, app_key)? else {
        return Ok(Checked::NoSession);
      };
      app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .header("Authorization", format!("Bearer {token}"))
        .map_err(|e| e.to_string())?
    }
    Source::Public(manifest_url) => {
      let endpoint = url::Url::parse(manifest_url).map_err(|e| e.to_string())?;
      app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
    }
  };
  let updater = builder
    .timeout(DOWNLOAD_TIMEOUT)
    .build()
    .map_err(|e| e.to_string())?;

  let update = match updater.check().await {
    Ok(Some(update)) => update,
    Ok(None) => {
      log::info!("team update: up to date");
      return Ok(Checked::Done);
    }
    // The team build's route: the session decides what this means.
    #[cfg(feature = "team")]
    Err(tauri_plugin_updater::Error::ReleaseNotFound) if matches!(source, Source::Team(_)) => {
      return Err(crate::team_session::update_refused(app));
    }
    // The public manifest: a release with no manifest yet, or one without
    // this platform. Nothing to do until the next one.
    Err(err) => return Err(err.to_string()),
  };

  // This version is already downloaded and waiting.
  if let Some(state) = app.try_state::<TeamUpdate>() {
    if let Ok(guard) = state.0.lock() {
      if guard.as_ref().map(|r| r.update.version == update.version) == Some(true) {
        return Ok(Checked::Done);
      }
    }
  }

  log::info!("team update: {} found, downloading", update.version);
  // `download` checks the signature before it returns the bytes.
  let bytes = update
    .download(|_, _| {}, || {})
    .await
    .map_err(|e| format!("download failed: {e}"))?;
  let info = UpdateInfo {
    version: update.version.clone(),
    notes: update.body.clone(),
  };
  if let Some(state) = app.try_state::<TeamUpdate>() {
    *state.0.lock().map_err(|e| e.to_string())? = Some(Ready { update, bytes });
  }
  log::info!("team update: {} ready", info.version);
  let _ = app.emit(READY_EVENT, info);
  Ok(Checked::Done)
}

/// The update waiting to be installed, if any. The interface asks at load,
/// because the event may have gone out before it was listening.
#[tauri::command]
pub fn team_update_status(app: tauri::AppHandle) -> Option<UpdateInfo> {
  let state = app.try_state::<TeamUpdate>()?;
  let guard = state.0.lock().ok()?;
  guard.as_ref().map(|r| UpdateInfo {
    version: r.update.version.clone(),
    notes: r.update.body.clone(),
  })
}

/// Install the waiting update and restart.
///
/// Tauri skips the quit hooks on a restart, so the wait for writes that the
/// window still owes the mailbox (see pending.rs) is done here first, with
/// the same cap as on quit. Off the main thread: the page reports its
/// writes over IPC while this waits.
#[tauri::command]
pub async fn team_update_install(app: tauri::AppHandle) -> Result<(), String> {
  let worker = app.clone();
  let installed = tauri::async_runtime::spawn_blocking(move || {
    let start = std::time::Instant::now();
    while crate::pending::pending_total() > 0 && start.elapsed() < WRITE_DRAIN_CAP {
      std::thread::sleep(Duration::from_millis(100));
    }
    install_waiting(&worker)
  })
  .await
  .map_err(|e| e.to_string())??;
  if !installed {
    return Err("No update is waiting".into());
  }
  app.request_restart();
  Ok(())
}

/// Call on `RunEvent::Exit`. An update that was downloaded but not
/// installed is installed now, so the next start is the new version.
pub fn install_on_exit(app: &tauri::AppHandle) {
  if let Err(err) = install_waiting(app) {
    log::warn!("team update: install on quit failed: {err}");
  }
}

/// Install the waiting update, once. False when nothing was waiting.
fn install_waiting(app: &tauri::AppHandle) -> Result<bool, String> {
  let Some(state) = app.try_state::<TeamUpdate>() else {
    return Ok(false);
  };
  let ready = state.0.lock().map_err(|e| e.to_string())?.take();
  let Some(ready) = ready else {
    return Ok(false);
  };
  log::info!("team update: installing {}", ready.update.version);
  ready
    .update
    .install(&ready.bytes)
    .map_err(|e| format!("install failed: {e}"))?;
  Ok(true)
}
