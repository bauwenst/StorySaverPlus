import type { ImageCandidate, IngestResult, KnownUser, MediaRecord, Reel, VideoVersion } from "./types";

const RELEVANT = ["video_dash_manifest", "videoDashManifest", "expiring_at", "reels_media", "highlight:"];

export function looksRelevant(text: string): boolean {
  return RELEVANT.some((marker) => text.includes(marker));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positive(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function userId(user: Record<string, unknown> | null): string | null {
  if (!user) return null;
  for (const key of ["id", "pk"]) {
    const value = user[key];
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  }
  return null;
}

function usernameOf(user: Record<string, unknown> | null): string {
  const name = text(user?.username);
  return name && name.length <= 64 ? name : "";
}

function mediaId(item: Record<string, unknown>): string | null {
  const rawId = text(item.id);
  const fromId = rawId?.split("_")[0] ?? "";
  if (/^\d{5,}$/.test(fromId)) return fromId;
  const pk = item.pk;
  if (typeof pk === "string" && /^\d{5,}$/.test(pk)) return pk;
  if (typeof pk === "number" && Number.isSafeInteger(pk) && pk > 0) return String(pk);
  return null;
}

function videoVersions(item: Record<string, unknown>): VideoVersion[] {
  const raw = item.video_versions ?? item.videoVersions;
  if (!Array.isArray(raw)) return [];
  const versions: VideoVersion[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const url = httpsUrl(record?.url);
    if (!record || !url) continue;
    versions.push({
      url,
      width: positive(record.width) ?? 0,
      height: positive(record.height) ?? 0,
      type: positive(record.type) ?? 0,
    });
  }
  return versions;
}

function imagesOf(item: Record<string, unknown>): ImageCandidate[] {
  const versions = asRecord(item.image_versions2 ?? item.imageVersions2);
  const raw = versions?.candidates;
  if (!Array.isArray(raw)) return [];
  const images: ImageCandidate[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const url = httpsUrl(record?.url);
    if (!record || !url) continue;
    images.push({
      url,
      width: positive(record.width) ?? 0,
      height: positive(record.height) ?? 0,
    });
  }
  return images;
}

function parseMediaItem(item: Record<string, unknown>, username: string): MediaRecord | null {
  const id = mediaId(item);
  if (!id) return null;
  const manifest = text(item.video_dash_manifest ?? item.videoDashManifest);
  const versions = videoVersions(item);
  const images = imagesOf(item);
  const mediaType = positive(item.media_type ?? item.mediaType);
  const owner = usernameOf(asRecord(item.user) ?? asRecord(item.owner)) || username;
  const takenAt = positive(item.taken_at ?? item.takenAt);
  const duration = positive(item.video_duration ?? item.videoDuration);

  if (mediaType === 1 || (!manifest && versions.length === 0 && images.length > 0 && mediaType !== 2)) {
    if (images.length === 0) return null;
    return {
      id,
      username: owner,
      takenAt,
      kind: "photo",
      duration: null,
      dashManifest: null,
      videoVersions: [],
      images,
    };
  }

  if (mediaType === 2 || manifest || versions.length > 0) {
    if (!manifest && versions.length === 0) return null;
    return {
      id,
      username: owner,
      takenAt,
      kind: "video",
      duration,
      dashManifest: manifest,
      videoVersions: versions,
      images: [],
    };
  }
  return null;
}

function mediaItems(node: Record<string, unknown>): unknown[] | null {
  const items = node.items ?? node.reel_items;
  if (Array.isArray(items)) return items;
  const connection = asRecord(items);
  if (connection && Array.isArray(connection.edges)) {
    return connection.edges.map((edge) => asRecord(edge)?.node).filter((node): node is Record<string, unknown> => !!node);
  }
  return null;
}

function isStoryReel(node: Record<string, unknown>, items: unknown[]): boolean {
  if (items.length === 0) return false;
  const id = text(node.id) ?? "";
  if (id.startsWith("highlight:")) return true;
  if (node.expiring_at != null || node.latest_reel_media != null || node.reel_type != null) return true;
  return false;
}

function reelKeys(node: Record<string, unknown>, username: string): string[] {
  const rawId = text(node.id) ?? "";
  if (rawId.startsWith("highlight:")) return [rawId];
  const keys: string[] = [];
  if (/^\d+$/.test(rawId)) keys.push(`id:${rawId}`);
  if (username) keys.push(`user:${username.toLowerCase()}`);
  return keys;
}

function addUser(users: KnownUser[], user: Record<string, unknown> | null): void {
  const id = userId(user);
  const username = usernameOf(user);
  if (!id || !username) return;
  if (!users.some((known) => known.username.toLowerCase() === username.toLowerCase() && known.id === id)) {
    users.push({ username, id });
  }
}

export function ingestJson(data: unknown): IngestResult {
  const result: IngestResult = { media: [], reels: [], users: [] };
  walk(data, 0, new WeakSet(), result);
  return result;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>, result: IngestResult): void {
  if (!value || depth > 30) return;
  if (typeof value === "string") {
    if (value.length > 40 && value.length < 2_000_000 && value.includes("{") && looksRelevant(value)) {
      try {
        walk(JSON.parse(value) as unknown, depth + 1, seen, result);
      } catch {
        return;
      }
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 2000);
    for (let index = 0; index < limit; index += 1) walk(value[index], depth + 1, seen, result);
    return;
  }

  const node = value as Record<string, unknown>;
  const items = mediaItems(node);
  if (items && isStoryReel(node, items)) {
    const user = asRecord(node.user) ?? asRecord(node.owner);
    addUser(result.users, user);
    const username = usernameOf(user);
    const itemIds: string[] = [];
    const seenIds = new Set<string>();
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const media = parseMediaItem(record, username);
      if (!media || seenIds.has(media.id)) continue;
      seenIds.add(media.id);
      itemIds.push(media.id);
      result.media.push(media);
    }
    if (itemIds.length > 0) {
      for (const key of reelKeys(node, username)) {
        result.reels.push({ key, username, itemIds: [...itemIds] });
      }
    }
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === "video_dash_manifest" || key === "videoDashManifest" || key === "video_versions" || key === "videoVersions") {
      continue;
    }
    walk(child, depth + 1, seen, result);
  }
}

export function mergeIngest(target: {
  byId: Map<string, MediaRecord>;
  reels: Map<string, Reel>;
  users: Map<string, string>;
}, result: IngestResult): void {
  for (const media of result.media) target.byId.set(media.id, media);
  for (const reel of result.reels) {
    if (reel.itemIds.length > 0) target.reels.set(reel.key, reel);
  }
  for (const user of result.users) target.users.set(user.username.toLowerCase(), user.id);
  while (target.byId.size > 500) {
    const oldest = target.byId.keys().next().value;
    if (!oldest) break;
    target.byId.delete(oldest);
  }
  while (target.reels.size > 40) {
    const oldest = target.reels.keys().next().value;
    if (!oldest) break;
    target.reels.delete(oldest);
  }
}
