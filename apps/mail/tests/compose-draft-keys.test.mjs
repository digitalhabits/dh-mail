/**
 * One draft key per new message.
 *
 * Every new message used to be written under the same key, so a second one
 * overwrote the first. Each composer now owns a key for its lifetime, which is
 * what lets the Drafts view list more than one — and what stops a composer
 * opened for somebody in particular destroying a half-written email.
 *
 * The old key is still recognised, because a draft written before this change
 * is still in the store.
 */

import {
  COMPOSE_DRAFT_KEY,
  composeDraftKey,
  isComposeDraftKey,
  newComposeDraftKey,
  threadDraftKey,
} from "@/lib/mail/local-drafts";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "a compose key is namespaced",
    composeDraftKey("abc") === "compose:abc",
    composeDraftKey("abc")
  );

  check(
    "two new messages get two keys",
    newComposeDraftKey() !== newComposeDraftKey()
  );

  check("a new key is recognised", isComposeDraftKey(newComposeDraftKey()));

  // A draft written before keys existed still lives under the bare word.
  check(
    "the old single key is still recognised",
    isComposeDraftKey(COMPOSE_DRAFT_KEY) && COMPOSE_DRAFT_KEY === "compose"
  );

  // The two kinds share a store, so they must not be mistaken for each other.
  check(
    "a thread draft key is not a compose key",
    !isComposeDraftKey(threadDraftKey("me@example.org", "t1")),
    threadDraftKey("me@example.org", "t1")
  );
  check(
    "a thread key is namespaced by account and thread",
    threadDraftKey("me@example.org", "t1") === "thread:me@example.org:t1"
  );
});
