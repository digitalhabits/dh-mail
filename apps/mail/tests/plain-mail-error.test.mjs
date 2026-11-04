/**
 * Mail errors in plain words (lib/mail/plain-mail-error.ts).
 *
 * A failed send showed "ews:network: The server did not answer. error
 * sending request for url (https://…)", and a file that did not come
 * showed the answer's JSON: {"error":"ews:invalid: The server did not
 * give this message."}. The reader gets words to act on instead.
 *
 * The server address is invented.
 */

import { plainMailError } from "@/lib/mail/plain-mail-error";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const network = plainMailError(
    new Error(
      "ews:network: The server did not answer. error sending request for url (https://mail.example.test/EWS/Exchange.asmx)"
    )
  );
  check(
    "a send with no answer says to check the connection, with no web address",
    network.startsWith("Mail could not reach the mail server") && !network.includes("http") && !network.includes("ews:"),
    network
  );

  const file = plainMailError('{"error":"ews:invalid: The server did not give this message."}');
  check(
    "a file the server did not give says so, with no JSON",
    file === "The mail server did not send this file. Try again in a minute.",
    file
  );

  const other = plainMailError('{"error":"ews:invalid: This mailbox has no Archive folder."}');
  check("an error that reads well keeps its words, without the code", other === "This mailbox has no Archive folder.", other);

  const busy = plainMailError(new Error("ews:busy: Server busy (retry after 30s)"));
  check("a busy server says to try again in a minute", busy === "The mail server is busy. Try again in a minute.", busy);

  check("plain text is left as it is", plainMailError("Couldn't read the attachment (500)") === "Couldn't read the attachment (500)");
  check("nothing at all gives the fallback", plainMailError("", "Couldn't save the file") === "Couldn't save the file");
  check("JSON that is not an error is left as it is", plainMailError("{not json") === "{not json");
});
