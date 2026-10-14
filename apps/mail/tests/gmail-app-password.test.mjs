/**
 * A Gmail connected with an app password.
 *
 * The password is kept where a Google grant is kept, behind a mark, and must
 * never be sent to Google as a refresh token. These are the rules that tell
 * it apart and store it as Google shows it.
 */

import {
  APP_PASSWORD_MARK,
  GmailAppPasswordError,
  appPasswordSecret,
  isAppPasswordSecret,
  isGmailAppPasswordError,
  looksLikeAppPassword,
} from "@/lib/mail/gmail-app-password";
import { check, suite } from "./harness.mjs";

suite(async () => {
  check("the mark is the one the native sync looks for", APP_PASSWORD_MARK === "app-password:");
  check("stored without the spaces Google shows it in",
    appPasswordSecret("abcd efgh ijkl mnop") === "app-password:abcdefghijklmnop");
  check("a stored app password is told apart", isAppPasswordSecret("app-password:abcdefghijklmnop"));
  check("a Google refresh token is not", !isAppPasswordSecret("1//0gExampleRefreshToken"));
  check("nothing stored is not", !isAppPasswordSecret(null) && !isAppPasswordSecret(undefined));
  check("sixteen letters in four groups is the shape", looksLikeAppPassword("abcd efgh ijkl mnop"));
  check("an ordinary password is not", !looksLikeAppPassword("hunter2"));
  check("nor sixteen with a digit", !looksLikeAppPassword("abcd efgh ijkl mno1"));
  const err = new GmailAppPasswordError("me@gmail.com");
  check("the error says what it is, and is known by name", isGmailAppPasswordError(err) && err.accountEmail === "me@gmail.com");
  check("and is not a reconnect", !/needs reconnect|invalid_grant/i.test(err.message));
  check("an ordinary error is not it", !isGmailAppPasswordError(new Error("boom")));
});
