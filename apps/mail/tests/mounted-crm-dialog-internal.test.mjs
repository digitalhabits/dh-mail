/**
 * The CRM proposal dialog, built as the team's app (the public one has no
 * CRM) and mounted against happy-dom with invented
 * proposals: one of each common kind, each drawn as its card with the
 * values the proposal carries, ready to edit before it is applied.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-crm-dialog-internal.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
