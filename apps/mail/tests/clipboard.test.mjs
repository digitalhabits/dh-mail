import {
  clipboardAttachments,
  uniqueAttachmentName,
} from "@/lib/mail/clipboard-attachments";
import { check, suite } from "./harness.mjs";

const png = (name) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

suite(async () => {
  // ---- Telling a file paste from a text paste -----------------------------
  // The whole rule. A paste with no file is left alone, so pasting text into
  // the message body still does what it always did.
  check("a text paste attaches nothing", clipboardAttachments({}).length === 0);
  check("a null clipboard attaches nothing", clipboardAttachments(null).length === 0);
  check(
    "an items list holding only text attaches nothing",
    clipboardAttachments({
      items: [{ kind: "string", getAsFile: () => null }],
    }).length === 0
  );

  // ---- A screenshot --------------------------------------------------------
  let out = clipboardAttachments({ files: [png("")] });
  check("a pasted screenshot is attached", out.length === 1);
  check(
    "an unnamed image is called image.png, as Gmail calls it",
    out[0].name === "image.png",
    out[0].name
  );
  check("the bytes survive the renaming", out[0].size === 4, String(out[0].size));
  check("and the type does too", out[0].type === "image/png", out[0].type);

  out = clipboardAttachments({ files: [new File([new Uint8Array([1])], "", { type: "image/jpeg" })] });
  check("a JPEG gets .jpg, not .jpeg", out[0].name === "image.jpg", out[0].name);

  out = clipboardAttachments({
    files: [new File([new Uint8Array([1])], "", { type: "application/octet-stream" })],
  });
  check(
    "a type that says nothing gets .bin, not .octetstream",
    out[0].name === "file.bin",
    out[0].name
  );

  out = clipboardAttachments({
    files: [new File([new Uint8Array([1])], "", { type: "application/pdf" })],
  });
  // "image.pdf" would be a lie, so only a picture is called one.
  check("something that is not a picture is not called one", out[0].name === "file.pdf", out[0].name);

  out = clipboardAttachments({
    files: [new File([new Uint8Array([1])], "", { type: "" })],
  });
  check("a file with no type at all still gets a name", out[0].name === "file.bin", out[0].name);

  // A name the clipboard gave is the sender's own, and is kept.
  out = clipboardAttachments({ files: [png("Screenshot 2026-08-11.png")] });
  check(
    "a file copied in Finder keeps the name it had",
    out[0].name === "Screenshot 2026-08-11.png",
    out[0].name
  );

  // ---- The older road ------------------------------------------------------
  out = clipboardAttachments({
    items: [
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => png("") },
    ],
  });
  check("items are read when files is empty", out.length === 1 && out[0].name === "image.png");

  check(
    "files wins over items, so nothing is attached twice",
    clipboardAttachments({
      files: [png("a.png")],
      items: [{ kind: "file", getAsFile: () => png("a.png") }],
    }).length === 1
  );

  // An item that says file but hands back nothing must not become a hole.
  out = clipboardAttachments({
    items: [{ kind: "file", getAsFile: () => null }],
  });
  check("an item with no file behind it is dropped", out.length === 0);

  // ---- Two screenshots in a row -------------------------------------------
  // Both are image.png. Two chips reading the same thing is a way to send the
  // wrong one; mail itself does not care, so this is for the person composing.
  check(
    "a repeated name is numbered",
    uniqueAttachmentName("image.png", ["image.png"]) === "image 2.png",
    uniqueAttachmentName("image.png", ["image.png"])
  );
  check(
    "and keeps counting",
    uniqueAttachmentName("image.png", ["image.png", "image 2.png"]) === "image 3.png"
  );
  check(
    "the number goes before the extension, not after it",
    uniqueAttachmentName("report.tar.gz", ["report.tar.gz"]) === "report.tar 2.gz"
  );
  check(
    "a name with no extension is still numbered",
    uniqueAttachmentName("LICENSE", ["LICENSE"]) === "LICENSE 2"
  );
  check(
    "a free name is left alone",
    uniqueAttachmentName("image.png", ["other.png"]) === "image.png"
  );
  check(
    "case does not let a duplicate through",
    uniqueAttachmentName("Image.PNG", ["image.png"]) === "Image 2.PNG",
    uniqueAttachmentName("Image.PNG", ["image.png"])
  );
});
