/**
 * Identifiers, from whichever crypto the host has.
 *
 * Node's `crypto` module does not exist in a webview, and the mail core runs in
 * one on the standalone product. Web Crypto is in every target: Node 19 and
 * later, and WKWebView.
 */
export function newMailId(): string {
  return globalThis.crypto.randomUUID();
}
