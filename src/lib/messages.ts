import type { PlaybackFile } from "./screen";
import type { IngestResult, SavePlan, SaveUsed } from "./types";
import { isSafeDownloadPath } from "./filename";

export const PAGE_SOURCE = "story-saver-plus";
export const UI_SOURCE = "story-saver-plus-ui";

export type PageToContent =
  | { source: typeof PAGE_SOURCE; type: "hello-ack" }
  | { source: typeof PAGE_SOURCE; type: "media-batch"; result: IngestResult }
  | { source: typeof PAGE_SOURCE; type: "reel-loaded"; requestId: string; ok: boolean; error?: string }
  | {
      source: typeof PAGE_SOURCE;
      type: "playback";
      requestId: string;
      videoSrc: string | null;
      imageSrc: string | null;
      width: number;
      height: number;
      files: PlaybackFile[];
    };

export type ContentToPage =
  | { source: typeof UI_SOURCE; type: "hello" }
  | { source: typeof UI_SOURCE; type: "load-reel"; requestId: string; username: string | null; highlightId: string | null }
  | { source: typeof UI_SOURCE; type: "read-playback"; requestId: string };

export type SaveRequest = {
  type: "save";
  token: number;
  filename: string;
  mode: SavePlan["mode"];
  url: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  progressiveUrl: string | null;
  requireAudio?: boolean;
};

export type SaveResponse =
  | { ok: true; used: SaveUsed; detail?: string | null }
  | { ok: false; error: string };

const MEDIA_HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

export function isHttpsMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function optionalUrl(value: unknown): string | null {
  if (value == null) return null;
  return isHttpsMediaUrl(value) ? value : null;
}

export function parseSaveRequest(value: unknown): SaveRequest | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<SaveRequest>;
  if (message.type !== "save") return null;
  if (typeof message.token !== "number" || !Number.isFinite(message.token)) return null;
  if (typeof message.filename !== "string" || !isSafeDownloadPath(message.filename)) return null;
  if (message.mode !== "photo" && message.mode !== "mux" && message.mode !== "silent" && message.mode !== "merged") {
    return null;
  }
  const url = optionalUrl(message.url);
  const videoUrl = optionalUrl(message.videoUrl);
  const audioUrl = optionalUrl(message.audioUrl);
  const progressiveUrl = optionalUrl(message.progressiveUrl);
  if (message.url != null && !url) return null;
  if (message.videoUrl != null && !videoUrl) return null;
  if (message.audioUrl != null && !audioUrl) return null;
  if (message.progressiveUrl != null && !progressiveUrl) return null;
  if (message.mode === "mux" && (!videoUrl || !audioUrl)) return null;
  if (message.mode !== "mux" && !url) return null;
  return {
    type: "save",
    token: message.token,
    filename: message.filename,
    mode: message.mode,
    url,
    videoUrl,
    audioUrl,
    progressiveUrl,
    requireAudio: message.requireAudio === true,
  };
}
