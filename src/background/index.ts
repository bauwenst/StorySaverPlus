import { filenameWithQuality, qualityLabel, qualitySuffix } from "../lib/filename";
import { parseSaveRequest, type SaveRequest } from "../lib/messages";
import { audioBitrateKbps, mp4DurationSeconds, mp4HasAudio, mp4Picture, stripByteRange } from "../lib/mp4";
import { muxVideoAndAudio, readVideoFacts } from "../lib/mux";
import { isInstagramPage, storyCanSave, TOAST_AUDIO_NOT_ADDED, TOAST_AUDIO_UNMATCHED, TOOLBAR_NEEDS_RELOAD, TOOLBAR_NOT_INSTAGRAM } from "../lib/status";
import type { SaveUsed } from "../lib/types";

function log(message: string, detail?: unknown): void {
  if (detail === undefined) console.info("[Story Saver Plus]", message);
  else console.info("[Story Saver Plus]", message, detail);
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) void askTab(tab.id);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "save-story") return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id != null) void askTab(tab.id);
  });
});

const DEFAULT_ICON = {
  "16": "icons/16.png",
  "32": "icons/32.png",
  "48": "icons/48.png",
  "128": "icons/128.png",
};
const READY_ICON = {
  "16": "icons/ready-16.png",
  "32": "icons/ready-32.png",
  "48": "icons/ready-48.png",
  "128": "icons/ready-128.png",
};

function showIcon(tabId: number, ready: boolean): void {
  void chrome.action.setIcon({ tabId, path: ready ? READY_ICON : DEFAULT_ICON });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  let pathname = "/";
  try {
    pathname = new URL(change.url).pathname;
  } catch {
    return;
  }
  if (!storyCanSave({ pathname, owner: null, busy: false })) showIcon(tabId, false);
});

chrome.runtime.onMessage.addListener((message: { type?: string; ready?: boolean }, sender, sendResponse) => {
  if (message?.type === "icon" && sender.tab?.id != null) {
    showIcon(sender.tab.id, message.ready === true);
    return;
  }
  if (message?.type !== "save") return;
  const request = parseSaveRequest(message);
  if (!request) {
    sendResponse({ ok: false, error: "The story file address was not one this extension can download." });
    return;
  }
  const tabId = sender.tab?.id;
  void runSave(request, tabId)
    .then((outcome) => sendResponse({ ok: true, used: outcome.used, detail: outcome.detail }))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Save failed.";
      sendResponse({ ok: false, error: text });
    });
  return true;
});

function paintPageNote(message: string): void {
  const id = "ssp-note";
  let note = document.getElementById(id);
  if (!(note instanceof HTMLParagraphElement)) {
    note = document.createElement("p");
    note.id = id;
    note.setAttribute("role", "status");
    note.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:16px",
      "z-index:2147483647",
      "max-width:min(360px, calc(100vw - 32px))",
      "margin:0",
      "padding:10px 12px",
      "border-radius:12px",
      "background:rgba(18, 16, 28, 0.94)",
      "color:white",
      "font:13px/1.4 ui-sans-serif, system-ui, sans-serif",
      "box-shadow:0 8px 24px rgba(0, 0, 0, 0.35)",
    ].join(";");
    document.documentElement.append(note);
  }
  note.textContent = message;
}

async function markToolbar(tabId: number, problem: string | null): Promise<void> {
  if (problem) {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#7a2424" });
    await chrome.action.setTitle({ tabId, title: problem });
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: "Save this story" });
}

async function askTab(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    log("could not read the active tab", error);
    return;
  }
  if (!isInstagramPage(tab.url)) {
    log("icon clicked away from Instagram", tab.url);
    await markToolbar(tabId, TOOLBAR_NOT_INSTAGRAM);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "save-now" });
    await markToolbar(tabId, null);
  } catch (error) {
    log("icon click did not reach the page", error);
    await markToolbar(tabId, TOOLBAR_NEEDS_RELOAD);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: paintPageNote, args: [TOOLBAR_NEEDS_RELOAD] });
    } catch (noteError) {
      log("could not show a note on the page", noteError);
    }
  }
}

function report(tabId: number | undefined, token: number, text: string): void {
  if (tabId == null) return;
  void chrome.tabs.sendMessage(tabId, { type: "progress", token, text }).catch(() => undefined);
}

async function fetchBlob(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(stripByteRange(url), { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("The video download timed out.");
    }
    throw error instanceof Error ? error : new Error("The media file could not be downloaded.");
  }
  if (response.status === 206 || response.headers.has("content-range")) {
    throw new Error("Instagram returned only part of the media file.");
  }
  if (response.status === 429) {
    throw new Error(
      "Instagram is rate-limiting downloads from this network (429). Waiting clears it. Another network will work sooner.",
    );
  }
  if (!response.ok) throw new Error(`The media file could not be downloaded (${response.status}).`);
  const blob = await response.blob();
  if (blob.size < 200) throw new Error("Instagram returned an empty media file.");
  return blob;
}

async function fetchPlayableVideo(url: string): Promise<Blob> {
  const blob = await fetchBlob(url);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const duration = mp4DurationSeconds(bytes);
  if (duration == null) throw new Error("The video file was incomplete, so it was not saved.");
  return new Blob([bytes], { type: "video/mp4" });
}

function download(options: chrome.downloads.DownloadOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (id) => {
      const error = chrome.runtime.lastError;
      if (error || id == null) reject(new Error(error?.message || "The download did not start."));
      else resolve(id);
    });
  });
}

async function downloadUrl(url: string, filename: string): Promise<void> {
  await download({ url, filename, saveAs: false, conflictAction: "uniquify" });
}

type OffscreenClient = {
  url: string;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

function extensionClients(): { matchAll: (options: { includeUncontrolled: boolean }) => Promise<OffscreenClient[]> } {
  return (self as unknown as { clients: { matchAll: (options: { includeUncontrolled: boolean }) => Promise<OffscreenClient[]> } }).clients;
}

async function offscreenClient(): Promise<OffscreenClient> {
  const pageUrl = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [pageUrl],
  });
  if (existing.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Save an assembled story video. The service worker cannot create a blob URL.",
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (!text.startsWith("Only a single offscreen")) throw error;
    }
  }
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const client = (await extensionClients().matchAll({ includeUncontrolled: true })).find((item) => item.url === pageUrl);
    if (client) return client;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The download page did not start.");
}

async function offscreenBlobUrl(blob: Blob): Promise<string> {
  const client = await offscreenClient();
  const result = await new Promise<{ ok: boolean; url?: string; error?: string }>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, error: "The download did not start." }), 15_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; url?: string; error?: string }>) => {
      clearTimeout(timer);
      resolve({ ok: event.data?.ok === true, url: event.data?.url, error: event.data?.error });
    };
    client.postMessage(blob, [channel.port2]);
  });
  if (!result.ok || !result.url) throw new Error(result.error || "The download did not start.");
  return result.url;
}

async function blobUrl(blob: Blob): Promise<string> {
  if (typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 180_000);
    return url;
  }
  return offscreenBlobUrl(blob);
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = await blobUrl(blob);
  await download({ url, filename, saveAs: false, conflictAction: "uniquify" });
}

async function namedFile(
  filename: string,
  video: Blob,
  audio: Uint8Array | null,
): Promise<{ filename: string; label: string }> {
  const picture = mp4Picture(new Uint8Array(await video.arrayBuffer()));
  const measured = await readVideoFacts(video);
  const facts = {
    width: measured.width || picture?.width || 0,
    height: measured.height || picture?.height || 0,
    frameRate: measured.frameRate >= 1 ? measured.frameRate : picture?.frameRate ?? 0,
    audioKbps: audio ? audioBitrateKbps(audio) ?? 0 : 0,
  };
  log("story quality", facts);
  return {
    filename: filenameWithQuality(filename, qualitySuffix(facts)),
    label: qualityLabel(facts),
  };
}

async function runSave(request: SaveRequest, tabId: number | undefined): Promise<{ used: SaveUsed; detail: string | null }> {
  if (request.mode === "mux" && request.videoUrl && request.audioUrl) {
    report(tabId, request.token, "Downloading the full video and audio…");
    const video = await fetchPlayableVideo(request.videoUrl);
    const videoBytes = new Uint8Array(await video.arrayBuffer());
    try {
      const audioBlob = await fetchBlob(request.audioUrl);
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
      if (audioBytes.byteLength < 200) throw new Error("The audio file was empty.");
      report(tabId, request.token, "Adding audio…");
      const file = await muxVideoAndAudio(new Blob([videoBytes], { type: "video/mp4" }), new Blob([audioBytes], { type: "audio/mp4" }));
      const combined = new Uint8Array(await file.arrayBuffer());
      if (mp4DurationSeconds(combined) == null) throw new Error("Combining the tracks produced an incomplete file.");
      const named = await namedFile(request.filename, video, audioBytes);
      await downloadBlob(new Blob([combined], { type: "video/mp4" }), named.filename);
      return { used: "mux", detail: named.label || null };
    } catch (error) {
      log("could not save the story with audio", error);
      if (request.progressiveUrl && stripByteRange(request.progressiveUrl) !== stripByteRange(request.videoUrl)) {
        try {
          report(tabId, request.token, "Saving Instagram's smaller file with audio…");
          const named = await namedFile(request.filename, video, null);
          await downloadUrl(stripByteRange(request.progressiveUrl), named.filename);
          return { used: "fallback", detail: null };
        } catch (fallbackError) {
          log("smaller file was not saved", fallbackError);
        }
      }
      throw new Error(TOAST_AUDIO_NOT_ADDED);
    }
  }

  if (request.requireAudio && request.url) {
    report(tabId, request.token, "Checking this story's audio…");
    const video = await fetchPlayableVideo(request.url);
    const bytes = new Uint8Array(await video.arrayBuffer());
    if (!mp4HasAudio(bytes)) throw new Error(TOAST_AUDIO_UNMATCHED);
    await downloadBlob(video, request.filename);
    return { used: "merged", detail: null };
  }

  if (!request.url) throw new Error("This story has no file to save.");
  if (request.mode === "photo") {
    report(tabId, request.token, "Saving…");
    await downloadUrl(stripByteRange(request.url), request.filename);
    return { used: request.mode, detail: null };
  }
  report(tabId, request.token, "Saving the full video…");
  await downloadUrl(stripByteRange(request.url), request.filename);
  log("download started", request.filename);
  return { used: request.mode, detail: null };
}
