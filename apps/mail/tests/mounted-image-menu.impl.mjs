/**
 * The walk itself — see mounted-image-menu.test.mjs.
 */

import { Window } from "happy-dom";

import { attachLinkContextMenu } from "@/components/mail/email-frame";
import { imageFileName } from "@/lib/mail/image-menu";
import { check, suite } from "./harness.mjs";

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

suite(async () => {
  const doc = new Window().document;
  doc.body.innerHTML =
    '<a href="https://news.example/story"><img id="linked" src="dhmail://localhost/abc"></a>' +
    '<img id="alone" src="data:image/png;base64,iVBORw0KGgo=">' +
    '<a id="text" href="https://news.example/more">More</a>';
  const asked = [];
  attachLinkContextMenu(doc, (request) => asked.push(request), () => {});
  const rightClick = (el) => el.dispatchEvent(new doc.defaultView.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

  rightClick(doc.getElementById("linked"));
  check("a linked picture: the link and the picture", asked[0]?.target === "https://news.example/story" && asked[0]?.image === "dhmail://localhost/abc", JSON.stringify(asked[0]));
  rightClick(doc.getElementById("alone"));
  check("a picture alone: the picture, and no link", asked[1]?.target === "" && /^data:image\/png/.test(asked[1]?.image ?? ""), JSON.stringify(asked[1]));
  rightClick(doc.getElementById("text"));
  check("a text link: no picture", asked[2]?.target === "https://news.example/more" && asked[2]?.image === undefined, JSON.stringify(asked[2]));

  check("a saved picture is named after its own address", imageFileName(`dhmail://localhost/${b64url("https://cdn.example/img/diagram-work.jpeg?w=800")}`, "image/jpeg") === "diagram-work.jpg");
  check("and its extension says what the bytes are", imageFileName(`dhmail://localhost/${b64url("https://cdn.example/a/b/photo.gif")}`, "image/png") === "photo.png");
  check("a picture with no address of its own is called image", imageFileName("data:image/png;base64,AAAA", "image/png") === "image.png");
});
