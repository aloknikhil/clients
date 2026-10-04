/**
 * Offscreen document: MV3 service workers have no DOM, so clipboard writes happen here.
 * `navigator.clipboard` requires focus, which offscreen documents never have, so this uses
 * the textarea + execCommand path that Chrome explicitly supports for offscreen clipboard use.
 */
const textarea = document.getElementById("clipboard") as HTMLTextAreaElement;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof message !== "object" || message === null) {
    return;
  }
  const { offscreen, text } = message as { offscreen?: string; text?: string };
  if (offscreen !== "copy" || typeof text !== "string") {
    return;
  }
  // execCommand("copy") ignores empty selections, so clearing writes a single space.
  textarea.value = text === "" ? " " : text;
  textarea.select();
  document.execCommand("copy");
  textarea.value = "";
  sendResponse(true);
});
