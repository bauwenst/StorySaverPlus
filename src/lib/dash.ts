import type { DashStream } from "./types";

export type DashSelection = {
  video: DashStream | null;
  audio: DashStream | null;
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return decodeXml(match[1] ?? match[2] ?? "");
}

function firstBaseUrl(xml: string): string | null {
  const match = xml.match(/<BaseURL\b[^>]*>([\s\S]*?)<\/BaseURL>/i);
  if (!match) return null;
  const url = decodeXml(match[1] ?? "");
  return url || null;
}

function parseRate(raw: string | null): number {
  if (!raw) return 0;
  if (raw.includes("/")) {
    const [numerator, denominator] = raw.split("/", 2);
    const den = Number(denominator);
    const num = Number(numerator);
    return den ? num / den : 0;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function resolveUrl(base: string | null, relative: string | null): string | null {
  if (!relative) return null;
  try {
    const url = new URL(relative, base ?? undefined);
    if (url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function kindFor(setAttrs: string, repAttrs: string, codecs: string): DashStream["kind"] | null {
  const mime = `${attr(setAttrs, "mimeType") ?? ""} ${attr(repAttrs, "mimeType") ?? ""}`.toLowerCase();
  const content = `${attr(setAttrs, "contentType") ?? ""} ${attr(repAttrs, "contentType") ?? ""}`.toLowerCase();
  if (mime.includes("audio") || content.includes("audio")) return "audio";
  if (mime.includes("video") || content.includes("video")) return "video";
  if (/^mp4a|^opus|^flac|^ac-3|^ec-3/.test(codecs)) return "audio";
  if (/^vp09|^vp9|^vp08|^avc1|^avc3|^hev1|^hvc1|^av01/.test(codecs)) return "video";
  return null;
}

function parseRepresentation(
  setAttrs: string,
  setBase: string | null,
  repAttrs: string,
  repBody: string,
): DashStream | null {
  const codecs = attr(repAttrs, "codecs") ?? "";
  const kind = kindFor(setAttrs, repAttrs, codecs);
  if (!kind) return null;
  const ownBase = firstBaseUrl(repBody);
  const url = resolveUrl(setBase, ownBase);
  if (!url) return null;
  return {
    kind,
    bandwidth: Number(attr(repAttrs, "bandwidth") ?? 0) || 0,
    width: Number(attr(repAttrs, "width") ?? 0) || 0,
    height: Number(attr(repAttrs, "height") ?? 0) || 0,
    frameRate: parseRate(attr(repAttrs, "frameRate")),
    sampleRate: Number(attr(repAttrs, "audioSamplingRate") ?? 0) || 0,
    codecs,
    url,
  };
}

export function parseDashManifest(xml: string): DashStream[] {
  if (!xml || !xml.includes("<")) return [];
  const streams: DashStream[] = [];
  const sets = xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi);
  let foundSet = false;
  for (const set of sets) {
    foundSet = true;
    const setAttrs = set[1] ?? "";
    const body = set[2] ?? "";
    const splitAt = body.search(/<Representation\b/i);
    const setBase = firstBaseUrl(splitAt === -1 ? body : body.slice(0, splitAt));
    for (const rep of body.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi)) {
      const stream = parseRepresentation(setAttrs, setBase, rep[1] ?? "", rep[2] ?? "");
      if (stream) streams.push(stream);
    }
  }
  if (foundSet) return streams;

  for (const rep of xml.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi)) {
    const stream = parseRepresentation("", null, rep[1] ?? "", rep[2] ?? "");
    if (stream) streams.push(stream);
  }
  return streams;
}

function betterVideo(current: DashStream, next: DashStream): DashStream {
  const currentPixels = current.width * current.height;
  const nextPixels = next.width * next.height;
  if (nextPixels !== currentPixels) return nextPixels > currentPixels ? next : current;
  if (next.bandwidth !== current.bandwidth) return next.bandwidth > current.bandwidth ? next : current;
  return next.frameRate > current.frameRate ? next : current;
}

function betterAudio(current: DashStream, next: DashStream): DashStream {
  if (next.bandwidth !== current.bandwidth) return next.bandwidth > current.bandwidth ? next : current;
  return next.sampleRate > current.sampleRate ? next : current;
}

export function pickBestStreams(xml: string): DashSelection {
  let video: DashStream | null = null;
  let audio: DashStream | null = null;
  for (const stream of parseDashManifest(xml)) {
    if (stream.kind === "video") video = video ? betterVideo(video, stream) : stream;
    else audio = audio ? betterAudio(audio, stream) : stream;
  }
  return { video, audio };
}

export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return "";
  const rounded = Math.round(fps);
  if (Math.abs(fps - rounded) < 0.05) return String(rounded);
  return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function describeVideo(video: DashStream, audio: DashStream | null): string {
  const parts = [`${video.width}×${video.height}`];
  const fps = formatFps(video.frameRate);
  if (fps) parts.push(`${fps} fps`);
  if (audio && audio.bandwidth > 0) parts.push(`${Math.round(audio.bandwidth / 1000)} kbps audio`);
  return parts.join(" · ");
}
