//! A mutex lock that still works after a panic.
//!
//! If a thread panics while it holds a `std::sync::Mutex`, the mutex is
//! "poisoned". After that, `lock().unwrap()` panics in every thread. For the
//! store, one panic then stopped all mail until the app started again.
//!
//! The data behind these locks stays usable after a panic: a SQLite
//! connection rolls back an open transaction, and a map or a flag is
//! complete after each write. So all code takes the guard as it is.
//! Use `locked()` in place of `lock().unwrap()`.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub trait LockExt<T: ?Sized> {
  /// The guard, also when an earlier holder panicked.
  fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> LockExt<T> for Mutex<T> {
  fn locked(&self) -> MutexGuard<'_, T> {
    self.lock().unwrap_or_else(PoisonError::into_inner)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Arc;

  #[test]
  fn a_lock_works_after_a_thread_panics_while_it_holds_it() {
    let shared = Arc::new(Mutex::new(vec![1]));
    let held = Arc::clone(&shared);
    let outcome = std::thread::spawn(move || {
      let mut guard = held.lock().unwrap();
      guard.push(2);
      panic!("a test panic while the lock is held");
    })
    .join();
    assert!(outcome.is_err());
    assert!(shared.is_poisoned());
    shared.locked().push(3);
    assert_eq!(*shared.locked(), vec![1, 2, 3]);
  }
}
