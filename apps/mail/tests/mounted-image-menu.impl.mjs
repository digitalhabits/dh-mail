/**
 * The walk itself — see mounted-image-menu.test.mjs.
 */

import { imageFileName } from "@/lib/mail/image-menu";
import { check, suite } from "./harness.mjs";

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

suite(async () => {
  // The right-click itself is read in the frame now: frame-script.test.mjs.
  check("a saved picture is named after its own address", imageFileName(`dhmail://localhost/${b64url("https://cdn.example/img/diagram-work.jpeg?w=800")}`, "image/jpeg") === "diagram-work.jpg");
  check("and its extension says what the bytes are", imageFileName(`dhmail://localhost/${b64url("https://cdn.example/a/b/photo.gif")}`, "image/png") === "photo.png");
  check("a picture with no address of its own is called image", imageFileName("data:image/png;base64,AAAA", "image/png") === "image.png");
});
