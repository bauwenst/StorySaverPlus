import type { MediaRecord, Reel, StoryLocation } from "./types";

const RESERVED_PROFILES = new Set([
  "about",
  "accounts",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "nametag",
  "privacy",
  "reel",
  "reels",
  "safety",
  "session",
  "stories",
  "tv",
]);

export function usernameFromProfilePath(pathname: string): string | null {
  const match = pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  const name = match?.[1];
  if (!name || name.includes("..") || RESERVED_PROFILES.has(name.toLowerCase())) return null;
  return name;
}

export function parseStoryLocation(pathname: string): StoryLocation {
  const path = pathname.split("?")[0] ?? "";
  const highlight = path.match(/^\/stories\/highlights\/(\d+)(?:\/(\d+))?\/?$/);
  if (highlight) {
    return {
      kind: "highlight",
      username: null,
      highlightId: highlight[1] ?? null,
      mediaId: highlight[2] ?? null,
    };
  }
  const story = path.match(/^\/stories\/([^/]+)(?:\/(\d+))?\/?$/);
  if (story && story[1] && story[1] !== "highlights") {
    let username = story[1];
    try {
      username = decodeURIComponent(username);
    } catch {
      username = story[1];
    }
    return {
      kind: "story",
      username,
      highlightId: null,
      mediaId: story[2] ?? null,
    };
  }
  return { kind: null, username: null, highlightId: null, mediaId: null };
}

export function panelIndexFromBars(hasNestedProgress: boolean[]): number | null {
  let found = -1;
  for (let index = 0; index < hasNestedProgress.length; index += 1) {
    if (!hasNestedProgress[index]) continue;
    if (found >= 0) return null;
    found = index;
  }
  return found < 0 ? null : found;
}

export function activeIndexFromFills(fills: number[]): number | null {
  if (fills.length === 0) return null;
  if (fills.every((fill) => fill > 0.9)) return fills.length - 1;
  let active = -1;
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index] ?? 0;
    if (fill > 0.02) active = index;
  }
  return active < 0 ? 0 : active;
}

function reelFor(location: StoryLocation, reels: ReadonlyMap<string, Reel>): Reel | null {
  if (location.highlightId) return reels.get(`highlight:${location.highlightId}`) ?? null;
  if (!location.username) return null;
  return reels.get(`user:${location.username.toLowerCase()}`) ?? reels.get(`id:${location.username}`) ?? null;
}

function itemAt(reel: Reel, index: number, byId: ReadonlyMap<string, MediaRecord>): MediaRecord | null {
  if (index < 0 || index >= reel.itemIds.length) return null;
  const id = reel.itemIds[index];
  return id ? byId.get(id) ?? null : null;
}

function uniqueDurationMatch(
  reel: Reel,
  byId: ReadonlyMap<string, MediaRecord>,
  duration: number,
): MediaRecord | null {
  const hits: MediaRecord[] = [];
  for (const id of reel.itemIds) {
    const media = byId.get(id);
    if (!media || media.kind !== "video" || media.duration == null) continue;
    if (Math.abs(media.duration - duration) <= 0.35) hits.push(media);
  }
  return hits.length === 1 ? hits[0] ?? null : null;
}

export function selectCurrent(input: {
  pathname: string;
  byId: ReadonlyMap<string, MediaRecord>;
  reels: ReadonlyMap<string, Reel>;
  progressIndex: number | null;
  videoDuration: number | null;
}): MediaRecord | null {
  const location = parseStoryLocation(input.pathname);
  if (!location.kind) return null;
  if (location.mediaId) return input.byId.get(location.mediaId) ?? null;

  const reel = reelFor(location, input.reels);
  if (!reel || reel.itemIds.length === 0) return null;
  if (reel.itemIds.length === 1) {
    const only = reel.itemIds[0];
    return only ? input.byId.get(only) ?? null : null;
  }

  const progress = input.progressIndex == null ? null : itemAt(reel, input.progressIndex, input.byId);
  const durationHit = input.videoDuration == null ? null : uniqueDurationMatch(reel, input.byId, input.videoDuration);
  if (
    progress &&
    durationHit &&
    progress.id !== durationHit.id &&
    progress.kind === "video" &&
    progress.duration != null &&
    input.videoDuration != null &&
    Math.abs(progress.duration - input.videoDuration) > 0.45
  ) {
    return durationHit;
  }
  if (progress) return progress;
  if (durationHit) return durationHit;
  return null;
}
