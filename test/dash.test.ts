import assert from "node:assert/strict";
import test from "node:test";
import { parseDashManifest, pickBestStreams } from "../src/lib/dash.ts";

const manifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation bandwidth="200000" width="360" height="640" frameRate="24" codecs="vp09.00.10.08">
        <BaseURL>https://scontent.cdninstagram.com/low.mp4?a=1&amp;b=2</BaseURL>
      </Representation>
      <Representation bandwidth="2500000" width="1080" height="1920" frameRate="30000/1001" codecs="vp09.00.31.08">
        <BaseURL>https://scontent.cdninstagram.com/high.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="4000000" width="720" height="1280" frameRate="60" codecs="vp09.00.31.08">
        <BaseURL>https://scontent.cdninstagram.com/mid60.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation bandwidth="64000" codecs="mp4a.40.5" audioSamplingRate="44100">
        <BaseURL>https://scontent.cdninstagram.com/a64.m4a</BaseURL>
      </Representation>
      <Representation bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000">
        <BaseURL>https://scontent.cdninstagram.com/a128.m4a</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

test("picks the largest video and the highest audio bitrate", () => {
  const picked = pickBestStreams(manifest);
  assert.equal(picked.video?.url, "https://scontent.cdninstagram.com/high.mp4");
  assert.equal(picked.video?.width, 1080);
  assert.equal(picked.video?.height, 1920);
  assert.ok(Math.abs((picked.video?.frameRate ?? 0) - 30000 / 1001) < 0.001);
  assert.equal(picked.audio?.url, "https://scontent.cdninstagram.com/a128.m4a");
  assert.equal(picked.audio?.bandwidth, 128000);
});

test("decodes XML entities in media URLs", () => {
  const low = parseDashManifest(manifest).find((stream) => stream.width === 360);
  assert.equal(low?.url, "https://scontent.cdninstagram.com/low.mp4?a=1&b=2");
});

test("resolves a representation URL against the adaptation base", () => {
  const xml = `
    <AdaptationSet mimeType="video/mp4">
      <BaseURL>https://scontent.cdninstagram.com/base/</BaseURL>
      <Representation bandwidth="10" width="10" height="10" codecs="avc1.4d401e">
        <BaseURL>file.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation bandwidth="32000" codecs="mp4a.40.2" audioSamplingRate="44100">
        <BaseURL>https://scontent.cdninstagram.com/a.m4a</BaseURL>
      </Representation>
    </AdaptationSet>`;
  const picked = pickBestStreams(xml);
  assert.equal(picked.video?.url, "https://scontent.cdninstagram.com/base/file.mp4");
  assert.equal(picked.audio?.url, "https://scontent.cdninstagram.com/a.m4a");
});

test("ignores manifests that are not XML", () => {
  assert.deepEqual(parseDashManifest("not xml"), []);
  assert.deepEqual(pickBestStreams(""), { video: null, audio: null });
});
