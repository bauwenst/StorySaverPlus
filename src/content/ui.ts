import { feedInset } from "./dom";

export type SaveState = "idle" | "busy" | "ok" | "error";

export type StoryUi = {
  place(onStory: boolean): void;
  setState(state: SaveState): void;
  setHint(text: string): void;
  setReady(ready: boolean): void;
  showToast(text: string, durationMs?: number): void;
  onSave(handler: () => void): void;
};

const CSS = `
#ssp-save {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483647;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
}
#ssp-save[hidden] { display: none; }
#ssp-save:hover { opacity: 0.92; }
#ssp-save:focus-visible { outline: 2px solid white; outline-offset: 2px; }
#ssp-save[data-state="busy"] { cursor: progress; }
#ssp-save img { width: 48px; height: 48px; display: block; }
#ssp-hint, #ssp-toast {
  position: fixed;
  left: 16px;
  bottom: 72px;
  z-index: 2147483647;
  max-width: min(360px, calc(100vw - 32px));
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(18, 16, 28, 0.94);
  color: white;
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
#ssp-hint, #ssp-toast { top: auto; }
`;

function iconImage(ready: boolean): string {
  return chrome.runtime.getURL(ready ? "icons/ready-48.png" : "icons/48.png");
}

export function mountUi(): StoryUi {
  const style = document.createElement("style");
  style.textContent = CSS;
  const button = document.createElement("button");
  button.id = "ssp-save";
  button.type = "button";
  button.title = "Save this story with audio";
  button.setAttribute("aria-label", "Save this story with audio");
  const image = document.createElement("img");
  image.alt = "";
  image.width = 48;
  image.height = 48;
  image.draggable = false;
  image.src = iconImage(false);
  button.append(image);
  const hint = document.createElement("p");
  hint.id = "ssp-hint";
  hint.setAttribute("role", "status");
  hint.setAttribute("aria-live", "polite");
  const toast = document.createElement("p");
  toast.id = "ssp-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.documentElement.append(style, button, hint, toast);

  const placeToast = () => {
    if (toast.hidden) return;
    if (hint.hidden) {
      toast.style.bottom = "72px";
      return;
    }
    const hintBottom = Number.parseFloat(hint.style.bottom || "72");
    toast.style.bottom = `${hintBottom + hint.offsetHeight + 8}px`;
  };

  const placeCluster = (onStory: boolean) => {
    const left = onStory ? 16 : feedInset();
    const width = `min(360px, ${Math.max(160, window.innerWidth - left - 16)}px)`;
    for (const node of [button, hint, toast]) node.style.left = `${left}px`;
    hint.style.maxWidth = width;
    toast.style.maxWidth = width;
    hint.style.bottom = "72px";
    placeToast();
  };

  for (const eventName of ["pointerdown", "mousedown", "pointerup", "click"] as const) {
    const stop = (event: Event) => event.stopPropagation();
    button.addEventListener(eventName, stop);
    hint.addEventListener(eventName, stop);
    toast.addEventListener(eventName, stop);
  }

  let hideTimer = 0;
  let saveHandler: () => void = () => undefined;
  button.addEventListener("click", () => saveHandler());

  return {
    place(onStory) {
      button.hidden = false;
      placeCluster(onStory);
    },
    setState(state) {
      button.dataset.state = state;
    },
    setReady(ready) {
      image.src = iconImage(ready);
    },
    setHint(text) {
      hint.textContent = text;
      hint.hidden = text.length === 0;
      placeToast();
    },
    showToast(text, durationMs = 5600) {
      toast.textContent = text;
      toast.hidden = false;
      placeToast();
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        toast.hidden = true;
      }, durationMs);
    },
    onSave(handler) {
      saveHandler = handler;
    },
  };
}
