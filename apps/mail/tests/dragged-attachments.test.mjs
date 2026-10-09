import { dragCarriesOnlyImages } from "@/lib/mail/dragged-attachments";
import { check, suite } from "./harness.mjs";

const file = (type) => ({ kind: "file", type });

suite(async () => {
  // ---- What goes into the message -----------------------------------------
  // The whole rule. Only a picture has anything to show inside a sentence,
  // so only a picture is offered the caret; everything else is attached.
  check("one picture goes in the message", dragCarriesOnlyImages([file("image/png")]));
  check(
    "several pictures go in together",
    dragCarriesOnlyImages([file("image/png"), file("image/jpeg"), file("image/gif")])
  );

  // ---- What stays an attachment -------------------------------------------
  check("a PDF is an attachment", !dragCarriesOnlyImages([file("application/pdf")]));
  check(
    "a Word file is an attachment",
    !dragCarriesOnlyImages([
      file("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ])
  );
  // Half in the message and half on the end of it would be one drop doing
  // two different things.
  check(
    "one PDF among the pictures makes the whole drop an attachment",
    !dragCarriesOnlyImages([file("image/png"), file("application/pdf")])
  );
  check(
    "a file the system cannot name is an attachment, not a guess",
    !dragCarriesOnlyImages([file("")])
  );

  // ---- Not a file at all ---------------------------------------------------
  // Dragging selected text over the composer must not arm the caret, or a
  // drag with nothing in it show a drop that inserts nothing.
  check(
    "dragged text is not a picture",
    !dragCarriesOnlyImages([{ kind: "string", type: "text/plain" }])
  );
  check(
    "an image dragged as text and as a file is still not only files",
    !dragCarriesOnlyImages([{ kind: "string", type: "text/uri-list" }, file("image/png")])
  );
  check("an empty drag carries no picture", !dragCarriesOnlyImages([]));
  check("a missing item list carries no picture", !dragCarriesOnlyImages(null));
});
