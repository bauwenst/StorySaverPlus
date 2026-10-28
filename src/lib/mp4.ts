const RANGE_PARAMS = new Set(["bytestart", "byteend", "range"]);

export function stripByteRange(input: string): string {
  const hashAt = input.indexOf("#");
  const hash = hashAt === -1 ? "" : input.slice(hashAt);
  const withoutHash = hashAt === -1 ? input : input.slice(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  if (queryAt === -1) return input;
  const path = withoutHash.slice(0, queryAt);
  const kept = withoutHash
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => {
      const name = (part.split("=", 1)[0] ?? "").toLowerCase();
      return !RANGE_PARAMS.has(name);
    });
  return kept.length > 0 ? `${path}?${kept.join("&")}${hash}` : `${path}${hash}`;
}

type Box = { type: string; start: number; end: number };

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset);
}

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0);
}

function boxes(data: Uint8Array, start: number, end: number): Box[] | null {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(data, offset);
    const type = fourcc(data, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const hi = u32(data, offset + 8);
      const lo = u32(data, offset + 12);
      size = hi * 0x1_0000_0000 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) return null;
    found.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  if (end - offset > 8) return null;
  return found;
}

function positiveDuration(timescale: number, duration: number): number | null {
  if (timescale === 0) return null;
  if (duration === 0) return null;
  if (duration === 0xffff_ffff) return Number.POSITIVE_INFINITY;
  return duration / timescale;
}

export function mp4DurationSeconds(data: Uint8Array): number | null {
  const top = boxes(data, 0, data.length);
  if (!top) return null;
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return null;
  const children = boxes(data, moov.start, moov.end);
  const mvhd = children?.find((box) => box.type === "mvhd");
  if (!mvhd) return null;
  const version = data[mvhd.start] ?? 0;
  if (version === 0) {
    if (mvhd.start + 20 > data.length) return null;
    const timescale = u32(data, mvhd.start + 12);
    const duration = positiveDuration(timescale, u32(data, mvhd.start + 16));
    if (duration != null) return duration;
    return fragmentDuration(data, children, timescale);
  }
  if (version === 1) {
    if (mvhd.start + 32 > data.length) return null;
    const timescale = u32(data, mvhd.start + 20);
    const hi = u32(data, mvhd.start + 24);
    const lo = u32(data, mvhd.start + 28);
    const duration = positiveDuration(timescale, hi * 0x1_0000_0000 + lo);
    if (duration != null) return duration;
    return fragmentDuration(data, children, timescale);
  }
  return null;
}

function findChild(data: Uint8Array, parent: Box, type: string): Box | null {
  return boxes(data, parent.start, parent.end)?.find((box) => box.type === type) ?? null;
}

function trackSize(data: Uint8Array, tkhd: Box): { width: number; height: number } | null {
  const version = data[tkhd.start] ?? 0;
  const offset = version === 0 ? 76 : version === 1 ? 88 : -1;
  if (offset < 0 || tkhd.start + offset + 8 > tkhd.end) return null;
  const width = u32(data, tkhd.start + offset) / 65536;
  const height = u32(data, tkhd.start + offset + 4) / 65536;
  if (width < 1 || height < 1) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function trackTiming(data: Uint8Array, mdhd: Box): { timescale: number } | null {
  const version = data[mdhd.start] ?? 0;
  const offset = version === 0 ? 12 : version === 1 ? 20 : -1;
  if (offset < 0 || mdhd.start + offset + 4 > mdhd.end) return null;
  const timescale = u32(data, mdhd.start + offset);
  return timescale > 0 ? { timescale } : null;
}

function frameRate(data: Uint8Array, stts: Box, timescale: number): number {
  if (stts.start + 8 > stts.end) return 0;
  const count = u32(data, stts.start + 4);
  let samples = 0;
  let units = 0;
  let offset = stts.start + 8;
  const entries = Math.min(count, 4096);
  for (let index = 0; index < entries; index += 1) {
    if (offset + 8 > stts.end) break;
    const sampleCount = u32(data, offset);
    const delta = u32(data, offset + 4);
    samples += sampleCount;
    units += sampleCount * delta;
    offset += 8;
  }
  if (samples <= 0 || units <= 0) return 0;
  return (samples * timescale) / units;
}

export function mp4Picture(data: Uint8Array): { width: number; height: number; frameRate: number } | null {
  const moov = boxes(data, 0, data.length)?.find((box) => box.type === "moov");
  if (!moov) return null;
  const tracks = boxes(data, moov.start, moov.end)?.filter((box) => box.type === "trak") ?? [];
  let best: { width: number; height: number; frameRate: number } | null = null;
  for (const trak of tracks) {
    const tkhd = findChild(data, trak, "tkhd");
    const mdia = findChild(data, trak, "mdia");
    if (!tkhd || !mdia) continue;
    const hdlr = findChild(data, mdia, "hdlr");
    if (hdlr && hdlr.start + 12 <= hdlr.end && fourcc(data, hdlr.start + 8) !== "vide") continue;
    const size = trackSize(data, tkhd);
    if (!size) continue;
    const mdhd = findChild(data, mdia, "mdhd");
    const timing = mdhd ? trackTiming(data, mdhd) : null;
    const minf = findChild(data, mdia, "minf");
    const stbl = minf ? findChild(data, minf, "stbl") : null;
    const stts = stbl ? findChild(data, stbl, "stts") : null;
    const rate = stts && timing ? frameRate(data, stts, timing.timescale) : 0;
    if (!best || size.width * size.height > best.width * best.height) best = { ...size, frameRate: rate };
  }
  return best;
}

export function mp4HasAudio(data: Uint8Array): boolean {
  const moov = boxes(data, 0, data.length)?.find((box) => box.type === "moov");
  if (!moov) return false;
  const tracks = boxes(data, moov.start, moov.end)?.filter((box) => box.type === "trak") ?? [];
  for (const trak of tracks) {
    const mdia = findChild(data, trak, "mdia");
    if (!mdia) continue;
    const hdlr = findChild(data, mdia, "hdlr");
    if (hdlr && hdlr.start + 12 <= hdlr.end && fourcc(data, hdlr.start + 8) === "soun") return true;
  }
  return false;
}

export function audioBitrateKbps(data: Uint8Array): number | null {
  const seconds = mp4DurationSeconds(data);
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const kbps = Math.round((data.byteLength * 8) / seconds / 1000);
  return kbps > 0 ? kbps : null;
}

function fragmentDuration(data: Uint8Array, moovChildren: Box[] | null, timescale: number): number | null {
  const mvex = moovChildren?.find((box) => box.type === "mvex");
  if (!mvex) return null;
  const mehd = boxes(data, mvex.start, mvex.end)?.find((box) => box.type === "mehd");
  if (!mehd) return null;
  const version = data[mehd.start] ?? 0;
  if (version === 0) {
    if (mehd.start + 8 > data.length) return null;
    return positiveDuration(timescale, u32(data, mehd.start + 4));
  }
  if (version === 1) {
    if (mehd.start + 12 > data.length) return null;
    const hi = u32(data, mehd.start + 4);
    const lo = u32(data, mehd.start + 8);
    return positiveDuration(timescale, hi * 0x1_0000_0000 + lo);
  }
  return null;
}
