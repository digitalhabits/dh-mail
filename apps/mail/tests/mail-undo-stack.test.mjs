/**
 * The stack behind Command+Z and each toast's Undo.
 *
 * Command+Z takes the newest action. A toast's Undo takes its own action,
 * even when newer ones followed. The stack keeps a fixed number, and the
 * oldest one drops off.
 */

import { createMailUndoStack } from "@/lib/mail/mail-undo-stack";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const stack = createMailUndoStack();
  check("a new stack is empty", stack.size === 0 && stack.pop() === undefined);

  stack.push({ id: "a" });
  stack.push({ id: "b" });
  stack.push({ id: "c" });
  check("pop takes the newest", stack.pop()?.id === "c", stack.size);

  stack.push({ id: "d" });
  check("take takes that entry, not the newest", stack.take("a")?.id === "a");
  check(
    "and the others stay in their order",
    stack.pop()?.id === "d" && stack.pop()?.id === "b" && stack.size === 0
  );

  stack.push({ id: "e" });
  check("take of an id not on the stack takes nothing", stack.take("zz") === undefined);
  check("and leaves the stack as it was", stack.size === 1);
  stack.take("e");
  check("an entry taken once cannot be taken again", stack.take("e") === undefined);

  const small = createMailUndoStack(3);
  for (const id of ["1", "2", "3", "4"]) small.push({ id });
  check("over the limit, the oldest drops off", small.take("1") === undefined, small.size);
  check("and the rest are kept", small.pop()?.id === "4" && small.size === 2);

  const full = createMailUndoStack();
  for (let i = 0; i < 60; i += 1) full.push({ id: String(i) });
  check("the default limit is fifty", full.size === 50 && full.take("9") === undefined);
});
