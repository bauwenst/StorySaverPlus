export function sanitizeName(name: string): string {
  const clean = name
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  if (!clean || clean === "." || clean === "..") return "instagram";
  return clean;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function padDay(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDay(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.getUTCFullYear()}-${padDay(date.getUTCMonth() + 1)}-${padDay(date.getUTCDate())}`;
}

export function postedDayFromTitle(title: string): string | null {
  const written = title.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (written) {
    const month = MONTHS[written[1]?.toLowerCase() ?? ""];
    const day = Number(written[2]);
    const year = Number(written[3]);
    if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      return `${year}-${padDay(month)}-${padDay(day)}`;
    }
  }
  const iso = title.trim().match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = Number(iso[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${iso[1]}-${iso[2]}-${iso[3]}`;
}

export function extensionFromUrl(url: string): string {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "jpeg" || ext === "jpg") return "jpg";
    if (ext === "png" || ext === "webp" || ext === "heic") return ext;
  } catch {
    return "jpg";
  }
  return "jpg";
}

export function storyFilename(username: string, takenAt: number | null, id: string, ext: string, postedDay?: string | null): string {
  const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "mp4";
  const when = postedDay && /^\d{4}-\d{2}-\d{2}$/.test(postedDay) ? postedDay : formatDay(takenAt && takenAt > 0 ? takenAt : Date.now() / 1000);
  const name = sanitizeName(username);
  const safeId = id.trim() === "" ? "" : /^\d+$/.test(id) ? id : sanitizeName(id);
  const stem = safeId ? `${name} ${when} ${safeId}` : `${name} ${when}`;
  return `StorySaverPlus/${stem}.${safeExt}`;
}

function leadingDigits(id: string | null): string | null {
  if (!id || !/^\d{4,}$/.test(id)) return null;
  return id.slice(0, 4);
}

export function filenameMark(input: { storyId: string | null; highlightId: string | null; panelIndex: number | null }): string | null {
  const highlight = leadingDigits(input.highlightId);
  if (highlight) {
    if (input.panelIndex == null || input.panelIndex < 0 || input.panelIndex > 9998) return highlight;
    return `${highlight}-${input.panelIndex + 1}`;
  }
  return leadingDigits(input.storyId);
}

export function filenameWithMark(filename: string, mark: string | null): string {
  if (!mark || !/^\d{4}(?:-\d{1,4})?$/.test(mark)) return filename;
  if (/ \d{8,}(?: |\.|$)/.test(filename) || filename.includes(` [${mark}]`)) return filename;
  const next = filename.replace(/(\.[a-z0-9]{2,5})$/i, ` [${mark}]$1`);
  return isSafeDownloadPath(next) ? next : filename;
}

export function filenameWithPostedDay(filename: string, postedDay: string | null): string {
  if (!postedDay || !/^\d{4}-\d{2}-\d{2}$/.test(postedDay)) return filename;
  const next = filename.replace(/ (\d{4}-\d{2}-\d{2}|\d{8}-\d{6})(?= |\.| \[)/, ` ${postedDay}`);
  return isSafeDownloadPath(next) ? next : filename;
}

function fpsText(frameRate: number): string {
  if (frameRate < 1) return "";
  const rounded = Math.round(frameRate);
  return Math.abs(frameRate - rounded) < 0.05 ? String(rounded) : frameRate.toFixed(2);
}

export function qualitySuffix(input: { width: number; height: number; frameRate: number; audioKbps: number }): string {
  const parts: string[] = [];
  if (input.width > 0 && input.height > 0) parts.push(`${Math.round(input.width)}x${Math.round(input.height)}`);
  const fps = fpsText(input.frameRate);
  if (fps) parts.push(`${fps}fps`);
  if (input.audioKbps > 0) parts.push(`${Math.round(input.audioKbps)}kbps`);
  return parts.join(" ");
}

export function qualityLabel(input: { width: number; height: number; frameRate: number; audioKbps: number }): string {
  const parts: string[] = [];
  if (input.width > 0 && input.height > 0) parts.push(`${Math.round(input.width)}×${Math.round(input.height)}`);
  const fps = fpsText(input.frameRate);
  if (fps) parts.push(`${fps} fps`);
  if (input.audioKbps > 0) parts.push(`${Math.round(input.audioKbps)} kbps audio`);
  return parts.join(" · ");
}

export function filenameWithQuality(filename: string, quality: string): string {
  if (!quality) return filename;
  const match = filename.match(/^(.* \d{4}-\d{2}-\d{2}) ([^/]+?)( \[[^\]]+\])?\.([a-z0-9]{2,5})$/);
  if (!match) return filename;
  const body = match[2] ?? "";
  if (/^\d+$/.test(body)) return filename;
  const currentSize = body.match(/^\d+x\d+/)?.[0];
  const combined = currentSize && !/^\d+x\d+/.test(quality) ? `${currentSize} ${quality}` : quality;
  const next = `${match[1]} ${combined}${match[3] ?? ""}.${match[4]}`;
  return isSafeDownloadPath(next) ? next : filename;
}

export function isSafeDownloadPath(filename: string): boolean {
  return (
    filename.startsWith("StorySaverPlus/") &&
    !filename.includes("..") &&
    !filename.includes("\\") &&
    !filename.includes("\0") &&
    filename.length < 180
  );
}
