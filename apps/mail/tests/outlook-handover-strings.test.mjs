import { mailSay } from "@/lib/mail/i18n-strings";
import { handoverFiles } from "@/lib/mail/outlook-compose";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // The count is written by the caller, so the sentence reads for one file
  // and for several without two strings to keep in step.
  const one = mailSay("outlookFilesInDownloads", { count: "1 file" });
  const many = mailSay("outlookFilesInDownloads", { count: "3 files" });
  check("one file reads as one", one.includes("1 file") && !one.includes("{count}"), one);
  check("three read as three", many.includes("3 files"), many);
  check("it says where they went", /downloads/i.test(one), one);

  const lost = mailSay("outlookFilesLeftBehind", { count: "2 files" });
  check("and says so when they could not go", lost.includes("2 files") && !lost.includes("{count}"), lost);
  check("without claiming they are anywhere", !/downloads/i.test(lost), lost);
});

/**
 * The pictures in the body travel with the files.
 *
 * When the mailbox is not one this app holds a token for, the handover
 * opens a blank Outlook message and puts the body on the pasteboard. The
 * HTML there holds each inline picture as a `data:` URI, and Outlook drops
 * those on the paste: the message arrived with its words and a gap where
 * each picture had been, and nothing said so.
 *
 * A send has somewhere better to put them — its own MIME part, referred to
 * by `cid:`. There is no message to make parts of here, so they go to the
 * downloads folder beside the attachments, to be dragged in.
 */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const body = (count) =>
  `<p>Like this:</p>${`<p><img src="data:image/png;base64,${PIXEL}"></p>`.repeat(count)}`;

{
  const none = handoverFiles([], "<p>No pictures at all.</p>");
  check("a message with nothing to carry carries nothing", none.length === 0);

  const filesOnly = handoverFiles(
    [{ filename: "schedule.pdf", contentBase64: "AAAA" }],
    "<p>No pictures at all.</p>"
  );
  check("the attachments still travel on their own", filesOnly.length === 1, filesOnly[0]?.filename);

  const both = handoverFiles(
    [{ filename: "schedule.pdf", contentBase64: "AAAA" }],
    body(2)
  );
  check("and the body's pictures travel with them", both.length === 3);
  check(
    "the files come first, so the reader drags what they attached first",
    both[0].filename === "schedule.pdf"
  );
  check(
    "each picture is named for what it is",
    both.slice(1).every((f) => /^image-\d+\.png$/.test(f.filename)),
    both.slice(1).map((f) => f.filename).join(", ")
  );
  check(
    "and carries its own bytes, ready to be written out",
    both.slice(1).every((f) => f.contentBase64 === PIXEL)
  );

  const picturesOnly = handoverFiles([], body(1));
  check(
    "a message with only pictures still says something travelled",
    picturesOnly.length === 1,
    "one picture, no attachments"
  );
}
