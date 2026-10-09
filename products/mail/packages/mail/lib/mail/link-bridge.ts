/**
 * The click bridge that runs inside an email frame, and the CSP hash that
 * permits it.
 *
 * The two live together, and away from the component, for one reason: they
 * have to agree byte for byte. `script-src` names the sha256 of the script, so
 * a one-character edit to the script without a new hash means the browser
 * refuses it — and the failure is silent. Links simply stop working, and only
 * in the desktop app, where the parent-side fallback listener is unreliable.
 *
 * `apps/mail/tests/link-bridge.test.mjs` recomputes the hash from the script
 * and fails when they drift.
 */

/**
 * Runs inside the email iframe (own realm). Parent listeners on sandboxed
 * srcdoc documents are flaky in WKWebView, so this posts the target out
 * instead: https to open in a browser, mailto to open our own composer.
 */
export const MAIL_LINK_BRIDGE_JS =
  '(function(){document.documentElement.setAttribute("data-dh-bridge","1");function u(el){if(!el||!el.getAttribute)return null;var r=(el.getAttribute("href")||el.getAttribute("data-dh-href")||"").trim();if(!r||r.charAt(0)==="#")return null;if(/^mailto:/i.test(r))return r;try{var b=document.baseURI==="about:srcdoc"?parent.location.href:document.baseURI;var a=new URL(r,b).href;if(/^https?:/i.test(a))return a}catch(e){}return null}document.addEventListener("click",function(e){var t=e.target;while(t&&t!==document){if(t.nodeType===1&&((t.tagName==="A"&&t.hasAttribute("href"))||t.hasAttribute("data-dh-href"))){var h=u(t);if(!h)return;e.preventDefault();e.stopImmediatePropagation();try{parent.postMessage({source:"dh-mail",type:"open-url",url:h},parent.location.origin)}catch(x){}return}t=t.parentNode}},true)})();';

/** sha256-base64 of MAIL_LINK_BRIDGE_JS (CSP script-src). */
export const MAIL_LINK_BRIDGE_CSP_HASH =
  "sha256-E7NlAkMMDK3r3Bl8hr5tnIL7oGXmsCQ9IVME0iPxFHU=";
