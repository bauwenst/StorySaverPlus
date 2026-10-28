import { parseStoryLocation } from "./select";
import type { StoryLocation } from "./types";

export const TOAST_ALREADY_DOWNLOADING = "Already downloading";
export const TOAST_NO_STORY = "No story selected yet";
export const TOAST_AUDIO_UNMATCHED = "Couldn't match this story's audio, so nothing was saved.";
export const TOAST_AUDIO_NOT_ADDED = "Couldn't add this story's audio, so nothing was saved.";

export const TOOLBAR_NOT_INSTAGRAM = "Open an Instagram story in this tab, then click the icon again.";
export const TOOLBAR_NEEDS_RELOAD =
  "Reload this Instagram tab, then click the icon again. Story Saver Plus was not attached yet.";

export function isInstagramPage(url: string | undefined): boolean {
  return url?.startsWith("https://www.instagram.com/") === true || url?.startsWith("https://instagram.com/") === true;
}

export function storyCanSave(input: { pathname: string; owner: string | null; busy: boolean }): boolean {
  if (input.busy) return false;
  const location = parseStoryLocation(input.pathname);
  if (location.kind === "story") return Boolean(location.username);
  if (location.kind === "highlight") return Boolean(input.owner?.trim());
  return false;
}

function readyFor(location: StoryLocation, owner: string | null): string {
  const named = owner?.trim() || null;
  if (location.kind === "highlight") return named ? `highlight by @${named}` : "this highlight";
  const name = location.username || named;
  return name ? `@${name}` : "this story";
}

export function describePageStatus(input: {
  pathname: string;
  hookReady: boolean;
  hookTimedOut: boolean;
  mediaCount: number;
  owner?: string | null;
}): string {
  if (input.hookTimedOut && !input.hookReady) return TOOLBAR_NEEDS_RELOAD;
  if (!input.hookReady) return "Story Saver Plus loaded. Connecting to the page…";

  const location = parseStoryLocation(input.pathname);
  if (!location.kind) {
    const path = input.pathname.length > 80 ? `${input.pathname.slice(0, 77)}…` : input.pathname;
    return `Open a story to save it. This page is ${path || "/"}.`;
  }

  if (location.kind === "highlight" && !input.owner?.trim()) return "Loading highlight…";

  const who = readyFor(location, input.owner ?? null);
  if (input.mediaCount === 0) return `Ready for ${who}.`;
  const files = input.mediaCount === 1 ? "1 story loaded" : `${input.mediaCount} stories loaded`;
  return `Ready for ${who}. ${files}.`;
}
