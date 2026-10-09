import { enqueueDraftWrite } from "@/lib/mail/draft-write-queue";
import { check, suite } from "./harness.mjs";

/** A task that records when it ran, and takes as long as it is told. */
const slot = (log, name, ms) => () =>
  new Promise((resolve) => {
    setTimeout(() => {
      log.push(name);
      resolve(name);
    }, ms);
  });

suite(async () => {
  // ---- The race that sent a message twice ----------------------------------
  // The save on a pause in the typing takes longer than the delete on Send.
  // Unqueued, the delete lands first and the save puts the sent message back
  // as a draft. Queued, they land in the order they were asked for.
  let log = [];
  const save = enqueueDraftWrite("thread:a", slot(log, "save", 30));
  const del = enqueueDraftWrite("thread:a", slot(log, "delete", 1));
  await Promise.all([save, del]);
  check(
    "the delete on Send lands after the save it raced, or the sent message comes back as a draft",
    log.join(",") === "save,delete",
    log.join(",")
  );

  // ---- A failed write does not dam the queue --------------------------------
  log = [];
  const bad = enqueueDraftWrite("thread:b", () =>
    Promise.reject(new Error("quota"))
  ).catch(() => log.push("failed"));
  const after = enqueueDraftWrite("thread:b", slot(log, "after", 1));
  await Promise.all([bad, after]);
  check(
    "a write that fails still lets the next one run",
    log.includes("after"),
    log.join(",")
  );

  // ---- Keys do not wait for each other --------------------------------------
  log = [];
  const slow = enqueueDraftWrite("thread:c", slot(log, "slow-c", 40));
  const quick = enqueueDraftWrite("thread:d", slot(log, "quick-d", 1));
  await Promise.all([slow, quick]);
  check(
    "one thread's slow save does not hold up another thread's",
    log[0] === "quick-d",
    log.join(",")
  );

  // ---- The caller gets its own answer back ----------------------------------
  const answer = await enqueueDraftWrite("thread:e", async () => "the draft");
  check("the queue hands back what the action returned", answer === "the draft", answer);
});
