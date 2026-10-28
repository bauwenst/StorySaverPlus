import { storyOwnerName, storyPanelIndex, storyPostedDay, storyProgressFills, visibleVideoDuration } from "./dom";
import { mountUi } from "./ui";
import { mergeIngest } from "../lib/extract";
import { PAGE_SOURCE, UI_SOURCE, type PageToContent, type SaveRequest, type SaveResponse } from "../lib/messages";
import { filenameMark, filenameWithMark, filenameWithPostedDay } from "../lib/filename";
import { planDownload, savedMessage } from "../lib/quality";
import { planFromPlayback, type PlaybackSnapshot } from "../lib/screen";
import { activeIndexFromFills, parseStoryLocation, selectCurrent } from "../lib/select";
import { describePageStatus, storyCanSave, TOAST_ALREADY_DOWNLOADING, TOAST_NO_STORY } from "../lib/status";
import type { MediaRecord, Reel } from "../lib/types";

const byId = new Map<string, MediaRecord>();
const reels = new Map<string, Reel>();
const users = new Map<string, string>();

let ui: ReturnType<typeof mountUi> | null = null;
let busy = false;
let activeToken = 0;
let hookReady = false;
let hookTimedOut = false;

function log(message: string, detail?: unknown): void {
  if (detail === undefined) console.info("[Story Saver Plus]", message);
  else console.info("[Story Saver Plus]", message, detail);
}

function ownerName(): string {
  const locationInfo = parseStoryLocation(location.pathname);
  if (locationInfo.username) return locationInfo.username;
  if (locationInfo.kind !== "highlight") return "";
  return storyOwnerName() || reels.get(`highlight:${locationInfo.highlightId}`)?.username || "";
}

function refreshHint(): void {
  ui?.setHint(
    describePageStatus({
      pathname: location.pathname,
      hookReady,
      hookTimedOut,
      mediaCount: byId.size,
      owner: ownerName(),
    }),
  );
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "Save failed.";
  return message.length > 280 ? `${message.slice(0, 277)}…` : message;
}

function canSaveNow(): boolean {
  return storyCanSave({ pathname: location.pathname, owner: ownerName(), busy });
}

function publishIcon(): void {
  const ready = canSaveNow();
  ui?.setReady(ready);
  void chrome.runtime.sendMessage({ type: "icon", ready }).catch(() => undefined);
}

function syncChrome(): void {
  ui?.place(parseStoryLocation(location.pathname).kind != null);
  refreshHint();
  publishIcon();
}

function watchLocation(): void {
  let last = location.pathname;
  const emit = () => {
    if (location.pathname === last) return;
    last = location.pathname;
    syncChrome();
  };
  window.addEventListener("popstate", emit);
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigatesuccess", emit);
  window.setInterval(() => {
    emit();
    ui?.place(parseStoryLocation(location.pathname).kind != null);
    refreshHint();
    publishIcon();
  }, 400);
}

function ping(): void {
  window.postMessage({ source: UI_SOURCE, type: "hello" }, location.origin);
}

function requestPlayback(): Promise<PlaybackSnapshot | null> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, 2000);
    const onMessage = (event: MessageEvent<PageToContent>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.source !== PAGE_SOURCE || data.type !== "playback" || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve({
        videoSrc: data.videoSrc,
        imageSrc: data.imageSrc,
        width: data.width,
        height: data.height,
        files: Array.isArray(data.files) ? data.files : [],
      });
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: UI_SOURCE, type: "read-playback", requestId }, location.origin);
  });
}

function requestReel(username: string | null, highlightId: string | null): Promise<{ ok: boolean; error?: string }> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "Timed out asking Instagram for this story." });
    }, 15000);
    const onMessage = (event: MessageEvent<PageToContent>) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.source !== PAGE_SOURCE || data.type !== "reel-loaded" || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve({ ok: data.ok, error: data.error });
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: UI_SOURCE, type: "load-reel", requestId, username, highlightId }, location.origin);
  });
}

function currentMedia() {
  let fills: number[] | null = null;
  let videoDuration: number | null = null;
  try {
    fills = storyProgressFills();
    videoDuration = visibleVideoDuration();
  } catch {
    fills = null;
    videoDuration = null;
  }
  return selectCurrent({
    pathname: location.pathname,
    byId,
    reels,
    progressIndex: fills ? activeIndexFromFills(fills) : null,
    videoDuration,
  });
}

async function saveCurrent(): Promise<void> {
  const locationInfo = parseStoryLocation(location.pathname);
  log("save requested", { path: location.pathname, hookReady, files: byId.size, busy });
  if (!ui) {
    log("save ignored because the button was not added");
    return;
  }
  const view = ui;
  if (busy) {
    view.showToast(TOAST_ALREADY_DOWNLOADING);
    return;
  }
  if (!canSaveNow()) {
    view.showToast(TOAST_NO_STORY);
    return;
  }

  const token = ++activeToken;
  busy = true;
  publishIcon();
  view.setState("busy");
  try {
    let media = currentMedia();
    let plan = media ? planDownload(media) : null;
    let requireAudio = false;
    if (!plan) {
      view.showToast("Saving the story already on screen…");
      const playback = await requestPlayback();
      if (token !== activeToken) return;
      const onScreen = playback ? planFromPlayback(playback, ownerName(), storyPostedDay()) : null;
      if (onScreen?.mode === "mux" || onScreen?.mode === "photo") {
        plan = onScreen;
        log("using the file already playing", { mode: plan.mode, label: plan.label });
      } else {
        view.showToast("Matching this story's audio…");
        const loaded = await requestReel(locationInfo.username, locationInfo.highlightId);
        if (token !== activeToken) return;
        media = currentMedia();
        plan = media ? planDownload(media) : null;
        if (!plan && onScreen) {
          plan = onScreen;
          requireAudio = true;
          log("story audio was not identified", { mode: plan.mode, label: plan.label });
        }
        if (!plan) {
          throw new Error(loaded.error || "Could not tell which story is on screen. Go to the next story and try again.");
        }
      }
    }
    const postedDay = storyPostedDay();
    if (postedDay) plan = { ...plan, filename: filenameWithPostedDay(plan.filename, postedDay) };
    const place = parseStoryLocation(location.pathname);
    const mark = filenameMark({
      storyId: place.kind === "highlight" ? null : place.mediaId ?? media?.id ?? null,
      highlightId: place.kind === "highlight" ? place.highlightId : null,
      panelIndex: place.kind === "highlight" ? storyPanelIndex() : null,
    });
    plan = { ...plan, filename: filenameWithMark(plan.filename, mark) };
    const request: SaveRequest = {
      type: "save",
      token,
      filename: plan.filename,
      mode: plan.mode,
      url: plan.url,
      videoUrl: plan.videoUrl,
      audioUrl: plan.audioUrl,
      progressiveUrl: plan.progressiveUrl,
      requireAudio,
    };
    const response = (await chrome.runtime.sendMessage(request)) as SaveResponse | undefined;
    if (token !== activeToken) return;
    if (!response?.ok) throw new Error(response?.error || "Save failed.");
    view.setState("ok");
    view.showToast(savedMessage(plan, response.used, response.detail ?? null), 12_000);
  } catch (error) {
    if (token !== activeToken) return;
    view.setState("error");
    view.showToast(errorText(error), 12_000);
  } finally {
    if (token === activeToken) {
      busy = false;
      publishIcon();
      window.setTimeout(() => {
        if (!busy) view.setState("idle");
      }, 2200);
    }
  }
}

let started = false;

function start(): void {
  if (started) return;
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    return;
  }
  started = true;
  log("content script started", location.href);
  ui = mountUi();
  ui.onSave(() => void saveCurrent());
  syncChrome();
  watchLocation();
  ping();
  window.setTimeout(() => {
    if (hookReady) return;
    hookTimedOut = true;
    log("page hook did not answer");
    refreshHint();
  }, 4000);
  const pingStarted = Date.now();
  const timer = window.setInterval(() => {
    if (Date.now() - pingStarted > 60_000) {
      window.clearInterval(timer);
      return;
    }
    ping();
  }, 500);

  window.addEventListener("message", (event: MessageEvent<PageToContent>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;
    if (data.type === "hello-ack") {
      window.clearInterval(timer);
      if (!hookReady) log("page hook connected");
      hookReady = true;
      hookTimedOut = false;
      refreshHint();
    }
    if (data.type === "media-batch") {
      const before = byId.size;
      mergeIngest({ byId, reels, users }, data.result);
      if (byId.size !== before) log("story data", { files: byId.size, reels: reels.size });
      refreshHint();
    }
  });

  chrome.runtime.onMessage.addListener((message: { type?: string; token?: number; text?: string }) => {
    if (message?.type === "save-now") {
      log("toolbar or shortcut asked to save");
      void saveCurrent();
    }
    if (message?.type === "progress" && message.token === activeToken && typeof message.text === "string") {
      ui?.showToast(message.text);
    }
  });
}

try {
  start();
} catch (error) {
  console.warn("[Story Saver Plus] could not add the save button", error);
}
