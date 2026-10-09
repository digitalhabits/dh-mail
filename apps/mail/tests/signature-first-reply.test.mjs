/**
 * Which messages carry the signature.
 *
 * A signature introduces you. So it goes on the message that does the
 * introducing — the first one you send in a conversation — and not on the
 * back and forth after it. That is the middle of three answers, and the
 * setting that used to be a tick could only offer the ends.
 *
 * Here: the rule itself, and what a setting saved by an older build means
 * when this one reads it.
 */

import { setMailStore } from "@/lib/mail/store";
import {
  getMailSignatureSettings,
  setMailSignatureSettings,
} from "@/lib/mail/settings";
import { signsThisReply } from "@/lib/mail/signature-rules";

import { check, suite } from "./harness.mjs";

const ACCOUNT = "you@example.org";

/** A store that is one settings table and nothing else. */
function fakeStore() {
  const values = new Map();
  return {
    values,
    settings: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => void values.set(key, value),
    },
  };
}

/** What the key for this account holds, as an object. */
function stored(store) {
  const [value] = [...store.values.values()];
  return JSON.parse(value);
}

suite(async () => {
  check(
    "the first reply in a conversation is signed",
    signsThisReply("first", false) === true
  );
  check(
    "and every reply after it is not",
    signsThisReply("first", true) === false
  );
  check(
    "every reply, for a reader who asks for that",
    signsThisReply("every", true) === true &&
      signsThisReply("every", false) === true
  );
  check(
    "and none at all for a reader who asks for that",
    signsThisReply("never", false) === false &&
      signsThisReply("never", true) === false
  );

  let store = fakeStore();
  setMailStore(store);
  check(
    "an address with nothing saved signs new mail and first replies",
    (await getMailSignatureSettings(ACCOUNT)).onReplies === "first"
  );

  store = fakeStore();
  setMailStore(store);
  store.values.set(
    "mail_signature:you@example.org",
    JSON.stringify({ signature: "U", includeOnNew: true, includeOnReplies: true })
  );
  check(
    "a reader who ticked the old box wanted every reply signed, and still gets that",
    (await getMailSignatureSettings(ACCOUNT)).onReplies === "every"
  );

  store.values.set(
    "mail_signature:you@example.org",
    JSON.stringify({ signature: "U", includeOnNew: true, includeOnReplies: false })
  );
  check(
    "an unticked box was the old default, not an answer, so it becomes the new one",
    (await getMailSignatureSettings(ACCOUNT)).onReplies === "first"
  );

  store = fakeStore();
  setMailStore(store);
  await setMailSignatureSettings(ACCOUNT, {
    signature: "  Ulrik  ",
    includeOnNew: true,
    onReplies: "never",
  });
  const saved = stored(store);
  check(
    "what is saved is the three-way answer, and the signature without its whitespace",
    saved.onReplies === "never" && saved.signature === "Ulrik",
    JSON.stringify(saved)
  );
  check(
    "with the old tick beside it, so a build from before this reads the setting",
    saved.includeOnReplies === false,
    JSON.stringify(saved)
  );

  await setMailSignatureSettings(ACCOUNT, {
    signature: "Ulrik",
    includeOnNew: true,
    onReplies: "every",
  });
  check(
    "and that tick is down only when every reply is signed",
    stored(store).includeOnReplies === true
  );
});
