import assert from "node:assert/strict";
import test from "node:test";
import { audioBitrateKbps, mp4DurationSeconds, mp4HasAudio, mp4Picture, stripByteRange } from "../src/lib/mp4.ts";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(type.split("").map((char) => char.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mvhd(duration: number, timescale = 1000): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box("mvhd", payload);
}

test("removes Instagram byte-range parameters and keeps the rest of the URL", () => {
  const full = stripByteRange(
    "https://scontent.cdninstagram.com/v/high.mp4?efg=abc&bytestart=0&byteend=5242879&_nc_ht=scontent.cdninstagram.com",
  );
  assert.equal(full, "https://scontent.cdninstagram.com/v/high.mp4?efg=abc&_nc_ht=scontent.cdninstagram.com");
  assert.equal(stripByteRange("https://scontent.cdninstagram.com/v/high.mp4"), "https://scontent.cdninstagram.com/v/high.mp4");
});

function tkhd(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  view.setUint32(76, width * 65536);
  view.setUint32(80, height * 65536);
  return box("tkhd", payload);
}

function mdhd(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box("mdhd", payload);
}

function hdlr(kind: string): Uint8Array {
  const payload = new Uint8Array(12);
  payload.set([...kind].map((char) => char.charCodeAt(0)), 8);
  return box("hdlr", payload);
}

function stts(count: number, delta: number): Uint8Array {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  view.setUint32(4, 1);
  view.setUint32(8, count);
  view.setUint32(12, delta);
  return box("stts", payload);
}

test("reads the picture size, frame rate, and audio bitrate", () => {
  const videoTrack = box("trak", concat([
    tkhd(1080, 1920),
    box("mdia", concat([
      mdhd(30_000, 150_000),
      hdlr("vide"),
      box("minf", box("stbl", stts(150, 1000))),
    ])),
  ]));
  const movie = concat([box("ftyp", new Uint8Array(4)), box("moov", concat([mvhd(5000), videoTrack])), box("mdat", new Uint8Array(32))]);
  assert.deepEqual(mp4Picture(movie), { width: 1080, height: 1920, frameRate: 30 });
  assert.equal(mp4HasAudio(movie), false);
  const withAudio = concat([
    box("ftyp", new Uint8Array(4)),
    box("moov", concat([
      mvhd(5000),
      videoTrack,
      box("trak", box("mdia", hdlr("soun"))),
    ])),
  ]);
  assert.equal(mp4HasAudio(withAudio), true);
  const head = concat([box("ftyp", new Uint8Array(4)), box("moov", mvhd(5000))]);
  const audio = concat([head, box("mdat", new Uint8Array(80_000 - head.length - 8))]);
  assert.equal(audio.byteLength, 80_000);
  assert.equal(audioBitrateKbps(audio), 128);
});

test("reads duration only from a complete MP4", () => {
  const movie = concat([box("ftyp", new Uint8Array([1, 2, 3, 4])), box("moov", mvhd(5000)), box("mdat", new Uint8Array(32))]);
  assert.equal(mp4DurationSeconds(movie), 5);
  assert.equal(mp4DurationSeconds(movie.slice(0, movie.length - 10)), null);
  assert.equal(mp4DurationSeconds(box("mdat", new Uint8Array(64))), null);
  assert.equal(mp4DurationSeconds(concat([box("ftyp", new Uint8Array(4)), box("moov", mvhd(0))])), null);
});
