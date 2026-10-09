fn main() {
  // Put Info.plist inside the binary itself, not only inside the .app.
  //
  // macOS refuses a privacy prompt to a process with no usage description, and
  // it refuses by killing it. `tauri build` writes Info.plist into the bundle,
  // so a shipped app is fine. `tauri dev` runs the bare binary from
  // target/debug, which is in no bundle and has no Info.plist — so the first
  // read of Contacts would crash the app rather than ask.
  //
  // A Mach-O carries the same keys in a __TEXT,__info_plist section, which is
  // where macOS looks when there is no bundle. Writing it here covers the
  // development build. The bundled build reads the real file and ignores this.
  #[cfg(target_os = "macos")]
  {
    let plist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist");
    println!("cargo:rerun-if-changed={}", plist.display());
    println!(
      "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
      plist.display()
    );
  }

  tauri_build::build()
}
