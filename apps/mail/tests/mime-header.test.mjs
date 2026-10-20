/**
 * Header lines for a message that goes out (lib/mail/mime-header.ts).
 *
 * A CR LF inside a header value ends that header, and what follows is read
 * as a header of its own. In-Reply-To and References are copied from the
 * message being answered, so the sender of that message can try it. Every
 * address and id here is invented.
 */

import { headerLine, headerValue, outgoingHeaderLines } from "@/lib/mail/mime-header";

import { check, suite } from "./harness.mjs";

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

/** The header names a list of lines would give a mail server. */
const namesIn = (lines) =>
  lines
    .join(CR + LF)
    .split(CR + LF)
    .map((line) => /^([^:\s]+):/.exec(line)?.[1])
    .filter(Boolean);

suite(async () => {
  check("a value loses its CR LF", headerValue(`<a@x.example>${CR}${LF}Bcc: eve@x.example`) === "<a@x.example> Bcc: eve@x.example");
  check("and a bare LF, a bare CR and a NUL", headerValue(`a${LF}b${CR}c${NUL}d`) === "a b c d");
  check("a plain value is left as it is", headerValue("<m1@mail.example> <m2@mail.example>") === "<m1@mail.example> <m2@mail.example>");
  let refused = false;
  try {
    headerLine(`X${CR}${LF}Bcc`, "x");
  } catch {
    refused = true;
  }
  check("a header name with a line break is refused", refused);

  const lines = outgoingHeaderLines({
    from: '"Ada Lind" <ada@choir.example>',
    to: [`bo@choir.example${CR}${LF}Bcc: eve@spy.example`],
    cc: [`cy@choir.example${LF}X-Injected: 1`],
    subject: "Thursday",
    messageId: "<new@choir.example>",
    inReplyTo: `<orig@choir.example>${CR}${LF}${CR}${LF}<html>a second body</html>`,
    references: `<one@choir.example>${CR}${LF}Bcc: eve@spy.example`,
  });
  const names = namesIn(lines);
  check(
    "no address, In-Reply-To or References can add a header",
    JSON.stringify(names) === JSON.stringify(["From", "To", "Cc", "Subject", "Message-ID", "In-Reply-To", "References", "MIME-Version"]),
    names.join(", ")
  );
  check("no line holds a CR or LF of its own", lines.every((line) => !line.includes(CR) && !line.includes(LF)));
  check("and nothing is lost but the breaks", lines.includes("In-Reply-To: <orig@choir.example> <html>a second body</html>"), lines.join(" | "));

  const bccOnly = outgoingHeaderLines({ from: "ada@choir.example", to: [], bcc: ["bo@choir.example"], subject: "s", messageId: "<m@choir.example>" });
  check("a message to Bcc alone still says so in To", bccOnly.includes("To: undisclosed-recipients:;"), bccOnly.join(" | "));
  check("and has no Cc, In-Reply-To or References", !bccOnly.some((l) => /^(Cc|In-Reply-To|References):/.test(l)));
  const blank = outgoingHeaderLines({ from: "ada@choir.example", to: ["bo@choir.example"], subject: "s", messageId: "<m@choir.example>", inReplyTo: `${CR}${LF}` });
  check("an In-Reply-To of only a line break is left off", !blank.some((l) => l.startsWith("In-Reply-To")), blank.join(" | "));
});
