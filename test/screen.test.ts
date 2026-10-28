import assert from "node:assert/strict";
import test from "node:test";
import { isSafeDownloadPath } from "../src/lib/filename.ts";
import { planFromPlayback, type PlaybackSnapshot } from "../src/lib/screen.ts";

const video = "https://scontent.cdninstagram.com/high.mp4";
const older = "https://scontent.cdninstagram.com/older.mp4";
const audio = "https://scontent.cdninstagram.com/sound.m4a";
const photo = "https://scontent.cdninstagram.com/story.jpg";

function snapshot(patch: Partial<PlaybackSnapshot>): PlaybackSnapshot {
  return {
    videoSrc: null,
    imageSrc: null,
    width: 1080,
    height: 1920,
    files: [],
    ...patch,
  };
}

test("saves the video already playing and the audio fetched with it", () => {
  const plan = planFromPlayback(
    snapshot({
      files: [
        { url: older, size: 9_000_000, at: 1_000 },
        { url: video, size: 2_000_000, at: 40_000 },
        { url: audio, size: 80_000, at: 40_400 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "mux");
  assert.equal(plan?.videoUrl, video);
  assert.equal(plan?.audioUrl, audio);
  assert.equal(plan?.progressiveUrl, video);
  assert.match(plan?.label ?? "", /1080×1920/);
  assert.match(plan?.label ?? "", /with audio/);
  assert.equal(isSafeDownloadPath(plan?.filename ?? ""), true);
  assert.match(plan?.filename ?? "", /^StorySaverPlus\/Ada \d{4}-\d{2}-\d{2} 1080x1920\.mp4$/);
});

test("pairs a direct player URL with the latest audio file", () => {
  const plan = planFromPlayback(
    snapshot({
      videoSrc: video,
      files: [{ url: audio, size: 80_000, at: 40_000 }],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "mux");
  assert.equal(plan?.videoUrl, video);
  assert.equal(plan?.audioUrl, audio);
});

test("prefers the player URL over an older downloaded video", () => {
  const plan = planFromPlayback(
    snapshot({
      videoSrc: video,
      files: [{ url: older, size: 9_000_000, at: 50_000 }],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "merged");
  assert.equal(plan?.url, video);
  assert.match(plan?.label ?? "", /without a separate audio file/);
});

test("ignores a blob URL and saves the photo on screen", () => {
  const plan = planFromPlayback(
    snapshot({
      videoSrc: "blob:https://www.instagram.com/11111111-2222-4333-8444-555555555555",
      imageSrc: photo,
      width: 1080,
      height: 1920,
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "photo");
  assert.equal(plan?.url, photo);
});

test("treats Instagram's smaller audio mp4 as the audio track", () => {
  const videoTag = encodeURIComponent(btoa('{"vencode_tag":"dash_baseline_1_v1"}'));
  const audioTag = encodeURIComponent(btoa('{"vencode_tag":"dash_ln_heaac_vbr3_audio"}'));
  const videoUrl = `https://scontent.cdninstagram.com/v.mp4?efg=${videoTag}`;
  const audioUrl = `https://scontent.cdninstagram.com/a.mp4?efg=${audioTag}`;
  const plan = planFromPlayback(
    snapshot({
      files: [
        { url: videoUrl, size: 10_000_000, at: 5_000 },
        { url: audioUrl, size: 90_000, at: 5_200 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "mux");
  assert.equal(plan?.videoUrl, videoUrl);
  assert.equal(plan?.audioUrl, audioUrl);
});

test("pairs one small mp4 fetched with the video when the audio tag is missing", () => {
  const plan = planFromPlayback(
    snapshot({
      files: [
        { url: video, size: 10_000_000, at: 5_000 },
        { url: "https://scontent.cdninstagram.com/a.mp4", size: 80_000, at: 5_100 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "mux");
  assert.equal(plan?.audioUrl, "https://scontent.cdninstagram.com/a.mp4");
});

test("keeps the audio from the story that started, not a story prefetched later", () => {
  const other = "https://scontent.cdninstagram.com/other-account.m4a";
  const plan = planFromPlayback(
    snapshot({
      videoSrc: video,
      files: [
        { url: video, size: 500_000, at: 1_000 },
        { url: audio, size: 80_000, at: 1_200 },
        { url: `${video}?bytestart=500000&byteend=2000000`, size: 1_500_000, at: 20_000 },
        { url: other, size: 70_000, at: 19_500 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "mux");
  assert.equal(plan?.videoUrl, video);
  assert.equal(plan?.audioUrl, audio);
});

test("rejects audio whose story id does not match the video", () => {
  const facts = (record: Record<string, unknown>) => encodeURIComponent(btoa(JSON.stringify(record)));
  const videoUrl = `https://scontent.cdninstagram.com/high.mp4?_nc_gid=story-a&efg=${facts({ vencode_tag: "dash_baseline_1_v1", duration_s: 7, asset_age_days: 1, video_id: "111" })}`;
  const audioUrl = `https://scontent.cdninstagram.com/sound.m4a?_nc_gid=story-a&efg=${facts({ vencode_tag: "dash_ln_heaac_vbr3_audio", duration_s: 7, asset_age_days: 1, video_id: "111" })}`;
  const other = `https://scontent.cdninstagram.com/other.m4a?_nc_gid=story-b&efg=${facts({ vencode_tag: "dash_ln_heaac_vbr3_audio", duration_s: 15, asset_age_days: 40, video_id: "222" })}`;
  const plan = planFromPlayback(
    snapshot({
      videoSrc: videoUrl,
      files: [
        { url: videoUrl, size: 2_000_000, at: 5_000 },
        { url: other, size: 90_000, at: 5_100 },
        { url: audioUrl, size: 80_000, at: 18_000 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.audioUrl, audioUrl);
});

test("does not guess among several audio files when the video request was not logged", () => {
  const plan = planFromPlayback(
    snapshot({
      videoSrc: video,
      files: [
        { url: "https://scontent.cdninstagram.com/older.m4a", size: 40_000, at: 1_000 },
        { url: "https://scontent.cdninstagram.com/newer.m4a", size: 50_000, at: 40_000 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "merged");
  assert.equal(plan?.audioUrl, null);
});

test("asks for the whole video instead of one byte range", () => {
  const plan = planFromPlayback(
    snapshot({
      files: [
        { url: `${video}?efg=abc&bytestart=0&byteend=500000`, size: 500_000, at: 10 },
        { url: `${video}?efg=abc&bytestart=500000&byteend=10000000`, size: 1_500_000, at: 20 },
      ],
    }),
    "Ada",
  );
  assert.equal(plan?.mode, "merged");
  assert.equal(plan?.url, `${video}?efg=abc`);
});

test("returns nothing when the page has no CDN file", () => {
  assert.equal(planFromPlayback(snapshot({ videoSrc: "https://example.com/video.mp4" }), "Ada"), null);
  assert.equal(planFromPlayback(snapshot({}), "Ada"), null);
});
