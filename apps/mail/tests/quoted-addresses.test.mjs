/**
 * Some senders put quotes round an address: <'ann@x.test'>. The quotes are
 * not part of it, and Gmail refuses a reply that keeps them.
 */

import { parseAddressList } from "@/lib/gmail/api";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const list = parseAddressList("Ann Berg <'ann@x.test'>, 'bo@y.test', o'neill@w.test");
  check("an address in <'…'> loses the quotes", list[0]?.email === "ann@x.test", JSON.stringify(list[0]));
  check("the name stays", list[0]?.name === "Ann Berg", list[0]?.name);
  check("a bare quoted address loses the quotes", list[1]?.email === "bo@y.test", list[1]?.email);
  check("a quote inside an address stays", list[2]?.email === "o'neill@w.test", list[2]?.email);
});
