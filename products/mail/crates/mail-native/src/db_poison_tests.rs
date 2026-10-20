//! The store goes on after a thread panics while it holds the connection.

use crate::db::MailDb;

#[test]
fn the_store_works_after_a_thread_panics_while_it_holds_the_connection() {
  let db = MailDb::open_in_memory().unwrap();
  let before = db
    .outbox_enqueue("reader@example.com", None, &["one@example.org".into()], "raw", "", &[], None, None)
    .unwrap();

  let outcome = std::thread::scope(|scope| {
    scope
      .spawn(|| {
        let conn = db.conn_mut();
        // A write that is not finished when the panic comes.
        conn.execute_batch("BEGIN; DELETE FROM outbox;").unwrap();
        panic!("a test panic while the store is held");
      })
      .join()
  });
  assert!(outcome.is_err(), "the thread panicked");

  // The half-done delete is rolled back, and reads and writes work.
  let rows = db.outbox_list("reader@example.com").unwrap();
  assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), vec![before]);
  db.outbox_enqueue("reader@example.com", None, &["two@example.org".into()], "raw", "", &[], None, None)
    .unwrap();
  assert_eq!(db.outbox_list("reader@example.com").unwrap().len(), 2);
}
