/**
 * The server search of the Exchange connect form (Autodiscover, section
 * 16.7 of docs/mail-exchange-ews.md).
 *
 * The access code still comes first. For a domain the app knows (ku.dk),
 * the server field fills itself and nothing is searched. For another
 * domain, "Find server" and Connect with an empty field search, and the
 * field fills from the answer. What the person typed wins. A host outside
 * the email's domain is asked about in the form, and only a yes searches
 * again with it. A refused password stops at once. Built as the public app.
 * Invented example.com data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-exchange-server-search.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
