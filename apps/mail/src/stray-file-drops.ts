/**
 * A file dropped where nothing takes it is ignored, not opened.
 *
 * The app turns the web view's own file drop handling off
 * (`dragDropEnabled: false`), so the page's drags work. A file dropped on
 * the window then falls to WebKit, which opens it in place of the app: a
 * PDF let go over the window fills it, with no way back short of quitting.
 *
 * The listeners are on the window, in the bubbling phase, so a place that
 * takes files (the composer, a folder in the rail) has answered first and
 * marked the event as handled. What is left over is refused: the pointer
 * shows that nothing will happen there, and the drop does nothing.
 */

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function ignoreStrayFileDrops(): void {
  window.addEventListener("dragover", (event) => {
    if (event.defaultPrevented || !carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  window.addEventListener("drop", (event) => {
    if (event.defaultPrevented || !carriesFiles(event)) return;
    event.preventDefault();
  });
}
