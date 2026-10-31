//! Each source file in this crate stays at 1500 lines or fewer.
//!
//! A long file is hard to read and hard to review. If this test fails,
//! move a section of the file into a child module. Do not raise the limit.

use std::path::{Path, PathBuf};

const MAX_LINES: usize = 1500;

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
  for entry in std::fs::read_dir(dir).expect("read src") {
    let path = entry.expect("dir entry").path();
    if path.is_dir() {
      rust_files(&path, out);
    } else if path.extension().is_some_and(|e| e == "rs") {
      out.push(path);
    }
  }
}

#[test]
fn every_source_file_is_at_most_1500_lines() {
  let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
  let mut files = Vec::new();
  rust_files(&src, &mut files);
  assert!(files.len() > 10, "found only {} files in {}", files.len(), src.display());
  let mut too_long: Vec<String> = files
    .iter()
    .filter_map(|path| {
      let lines = std::fs::read_to_string(path).expect("read file").lines().count();
      (lines > MAX_LINES).then(|| format!("{} ({lines} lines)", path.strip_prefix(&src).unwrap().display()))
    })
    .collect();
  too_long.sort();
  assert!(too_long.is_empty(), "files over {MAX_LINES} lines: {}", too_long.join(", "));
}
