import { storyFilename } from "./filename";
import { stripByteRange } from "./mp4";
import type { SavePlan } from "./types";

const HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

export type PlaybackFile = {
  url: string;
  size: number;
  at: number;
  started?: number;
};

export type PlaybackSnapshot = {
  videoSrc: string | null;
  imageSrc: string | null;
  width: number;
  height: number;
  files: PlaybackFile[];
};

export function isCdnUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function decodeEfg(url: string): string {
  try {
    const raw = new URL(url).searchParams.get("efg");
    if (!raw) return "";
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
  } catch {
    return "";
  }
}

function encodeTag(url: string): string {
  const decoded = decodeEfg(url).toLowerCase();
  if (!decoded) return "";
  return decoded.match(/"vencode_tag"\s*:\s*"([^"]*)"/)?.[1] ?? decoded;
}

type EncodeFacts = {
  videoId: string | null;
  duration: number | null;
  ageDays: number | null;
};

function encodeFacts(url: string): EncodeFacts {
  const empty: EncodeFacts = { videoId: null, duration: null, ageDays: null };
  const decoded = decodeEfg(url);
  if (!decoded) return empty;
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") return empty;
    const record = parsed as Record<string, unknown>;
    const videoId = record.video_id;
    const duration = record.duration_s;
    const age = record.asset_age_days;
    return {
      videoId: typeof videoId === "string" && videoId ? videoId : typeof videoId === "number" && videoId > 0 ? String(videoId) : null,
      duration: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
      ageDays: typeof age === "number" && Number.isFinite(age) ? age : null,
    };
  } catch {
    return empty;
  }
}

function groupId(url: string): string | null {
  try {
    const value = new URL(url).searchParams.get("_nc_gid");
    return value || null;
  } catch {
    return null;
  }
}

function conflicts(videoUrl: string, audioUrl: string): boolean {
  const video = encodeFacts(videoUrl);
  const audio = encodeFacts(audioUrl);
  if (video.duration != null && audio.duration != null && Math.abs(video.duration - audio.duration) > 1) return true;
  if (video.ageDays != null && audio.ageDays != null && video.ageDays !== audio.ageDays) return true;
  if (video.videoId && audio.videoId && video.videoId !== audio.videoId) return true;
  const videoGroup = groupId(videoUrl);
  const audioGroup = groupId(audioUrl);
  return Boolean(videoGroup && audioGroup && videoGroup !== audioGroup);
}

function sameAsset(videoUrl: string, audioUrl: string): boolean {
  const video = encodeFacts(videoUrl);
  const audio = encodeFacts(audioUrl);
  if (video.videoId && audio.videoId && video.videoId === audio.videoId) return true;
  const videoGroup = groupId(videoUrl);
  const audioGroup = groupId(audioUrl);
  return Boolean(videoGroup && audioGroup && videoGroup === audioGroup);
}

export function playbackKind(url: string): "video" | "audio" | "image" | null {
  const tag = encodeTag(url);
  if (/audio|heaac|mp4a/.test(tag)) return "audio";
  const path = url.toLowerCase();
  if (/\.(?:m4a|aac|mp3)(?:$|\?)/.test(path) || path.includes("mime_type=audio") || path.includes("/audio/")) return "audio";
  if (/\.(?:jpg|jpeg|png|webp)(?:$|\?)/.test(path)) return "image";
  if (/\.(?:mp4|m4v|webm|m4s)(?:$|\?)/.test(path) || path.includes("mime_type=video")) return "video";
  return null;
}

function playbackId(width: number, height: number): string {
  if (width > 0 && height > 0) return `${Math.round(width)}x${Math.round(height)}`;
  return "";
}

function sizeLabel(width: number, height: number): string {
  if (width > 0 && height > 0) return `${Math.round(width)}×${Math.round(height)}`;
  return "the story already playing";
}

function wholeFile(url: string): string {
  return stripByteRange(url);
}

function isFragment(url: string): boolean {
  return /\.m4s(?:$|\?)/i.test(url);
}

function samePath(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
}

function firstSeen(file: PlaybackFile): number {
  return file.started ?? file.at;
}

function deduped(files: PlaybackFile[]): PlaybackFile[] {
  const byUrl = new Map<string, PlaybackFile>();
  for (const file of files) {
    const url = wholeFile(file.url);
    if (!isCdnUrl(url) || isFragment(url) || !Number.isFinite(file.at)) continue;
    const size = Number.isFinite(file.size) && file.size > 0 ? file.size : 0;
    const started = firstSeen(file);
    const existing = byUrl.get(url);
    if (!existing) {
      byUrl.set(url, { url, size, at: file.at, started });
      continue;
    }
    existing.size += size;
    if (file.at > existing.at) existing.at = file.at;
    if (started < firstSeen(existing)) existing.started = started;
  }
  return [...byUrl.values()];
}

function pickVideo(files: PlaybackFile[], videoSrc: string | null): PlaybackFile | null {
  const direct = videoSrc ? wholeFile(videoSrc) : null;
  if (direct && isCdnUrl(direct) && !isFragment(direct) && playbackKind(direct) !== "image" && playbackKind(direct) !== "audio") {
    return files.find((file) => file.url === direct || samePath(file.url, direct)) ?? { url: direct, size: 0, at: 0 };
  }
  const videos = files.filter((file) => playbackKind(file.url) === "video");
  if (videos.length === 0) return null;
  const newest = Math.max(...videos.map((file) => file.at));
  const cluster = videos.filter((file) => newest - file.at <= 15_000);
  const substantial = cluster.filter((file) => file.size >= 20_000);
  const pool = substantial.length > 0 ? substantial : cluster;
  return pool.sort((a, b) => b.size - a.size || b.at - a.at)[0] ?? null;
}

const AUDIO_WITH_VIDEO_MS = 4_000;

function chooseAudio(candidates: PlaybackFile[], videoUrl: string, origin: number): PlaybackFile | null {
  if (candidates.length === 0) return null;
  const strong = candidates.filter((file) => sameAsset(videoUrl, file.url));
  const pool = strong.length > 0 ? strong : candidates.filter((file) => origin > 0 && Math.abs(firstSeen(file) - origin) <= AUDIO_WITH_VIDEO_MS);
  if (pool.length === 0) return origin <= 0 && strong.length === 0 && candidates.length === 1 ? candidates[0] ?? null : null;
  return pool.sort((a, b) => {
    if (origin > 0) {
      const distance = Math.abs(firstSeen(a) - origin) - Math.abs(firstSeen(b) - origin);
      if (distance !== 0) return distance;
    } else if (a.at !== b.at) return b.at - a.at;
    return b.size - a.size;
  })[0] ?? null;
}

function pickAudio(files: PlaybackFile[], video: PlaybackFile): PlaybackFile | null {
  const origin = firstSeen(video);
  const tagged = files.filter((file) => playbackKind(file.url) === "audio" && file.url !== video.url);
  if (tagged.length > 0) return chooseAudio(tagged.filter((file) => !conflicts(video.url, file.url)), video.url, origin);
  const companions = files.filter((file) => {
    if (file.url === video.url || playbackKind(file.url) !== "video" || !/\.mp4(?:$|\?)/i.test(file.url)) return false;
    if (conflicts(video.url, file.url) || file.size < 8_000 || file.size > 400_000) return false;
    return video.size <= 0 || file.size < video.size * 0.25;
  });
  if (companions.length !== 1) return null;
  return chooseAudio(companions, video.url, origin);
}

export function planFromPlayback(snapshot: PlaybackSnapshot, username: string, postedDay?: string | null): SavePlan | null {
  const files = deduped(snapshot.files);
  const video = pickVideo(files, snapshot.videoSrc);
  if (video) {
    const audio = pickAudio(files, video);
    const label = `${sizeLabel(snapshot.width, snapshot.height)} from the story already playing${audio ? ", with audio" : ", without a separate audio file"}`;
    const filename = storyFilename(username, null, playbackId(snapshot.width, snapshot.height), "mp4", postedDay);
    if (audio) {
      return {
        filename,
        mode: "mux",
        label,
        fallbackLabel: sizeLabel(snapshot.width, snapshot.height),
        url: null,
        videoUrl: video.url,
        audioUrl: audio.url,
        progressiveUrl: video.url,
      };
    }
    return {
      filename,
      mode: "merged",
      label,
      fallbackLabel: null,
      url: video.url,
      videoUrl: null,
      audioUrl: null,
      progressiveUrl: null,
    };
  }

  const imageUrl = snapshot.imageSrc && isCdnUrl(snapshot.imageSrc) ? snapshot.imageSrc : null;
  const image = imageUrl
    ? { url: imageUrl, size: 0, at: 0 }
    : files.filter((file) => playbackKind(file.url) === "image").sort((a, b) => b.at - a.at || b.size - a.size)[0];
  if (!image) return null;
  return {
    filename: storyFilename(username, null, playbackId(snapshot.width, snapshot.height), "jpg", postedDay),
    mode: "photo",
    label: `${sizeLabel(snapshot.width, snapshot.height)} photo from the story already playing`,
    fallbackLabel: null,
    url: image.url,
    videoUrl: null,
    audioUrl: null,
    progressiveUrl: null,
  };
}
