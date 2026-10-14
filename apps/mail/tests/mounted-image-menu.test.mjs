/**
 * A right-click on a picture in a message offers Copy image and Download
 * image: on a picture that is also a link, beside the link's lines; on a
 * picture alone, by themselves. The saved file is named after the picture.
 * Invented addresses only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-image-menu.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
