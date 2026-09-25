/**
 * The composer sends what the writer sees.
 *
 * Mounted as mounted-smoke is, against happy-dom and the transport seam.
 * Each walk changes one field last and then sends. The send must carry the
 * new value, not the value from an earlier render.
 *
 * One walk presses Undo after Send. The composer must come back with the
 * same words, recipients and subject, and the second Send must carry them.
 *
 * A second Undo walk has a file on the message, and a last walk plays the
 * pop-out: it stores a draft with a file and sends the focus event. In both,
 * the file must come back to the strip.
 *
 * The last walk has a slow store. The composer opens and closes before the
 * store answers the read of the draft. The draft that then opens must be
 * saved again.
 *
 * Two more walks hold the draft. Each writes a message, opens a different
 * conversation, and comes back. The pane is made again for each thread, so
 * the words, the recipients and the subject must come back from the stored
 * draft. These walks must pass before and after the composer moves out of
 * ThreadPane.
 *
 * The last walks close gaps the ThreadPane split left open: the Reply button
 * at the foot of the thread, the question a message that speaks of a file
 * and carries none is asked (Go back sends nothing, Send anyway sends), and
 * the Escape question (Keep draft keeps the words, Enter discards). A
 * walk sends with Command+Enter from inside the reply. Two more open Edit
 * subject, under the box, and Preview first from the Send options. A reply
 * under a new subject goes without the thread's id and still answers the
 * message.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-composer-send.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
