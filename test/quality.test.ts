import assert from "node:assert/strict";
import test from "node:test";
import { filenameMark, filenameWithMark, filenameWithPostedDay, filenameWithQuality, formatDay, isSafeDownloadPath, postedDayFromTitle, qualityLabel, qualitySuffix, sanitizeName, storyFilename } from "../src/lib/filename.ts";
import { parseSaveRequest } from "../src/lib/messages.ts";
import { describeResult, planDownload, savedMessage } from "../src/lib/quality.ts";
import type { MediaRecord } from "../src/lib/types.ts";

const takenAt = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000;
const manifest = `<AdaptationSet mimeType="video/mp4"><Representation bandwidth="2500000" width="1080" height="1920" frameRate="30" codecs="vp09.00.31.08"><BaseURL>https://scontent.cdninstagram.com/high.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000" codecs="mp4a.40.2"><BaseURL>https://scontent.cdninstagram.com/a.m4a</BaseURL></Representation></AdaptationSet>`;

function media(patch: Partial<MediaRecord>): MediaRecord {
  return {
    id: "555",
    username: "Ada",
    takenAt,
    kind: "video",
    duration: 6,
    dashManifest: manifest,
    videoVersions: [{ url: "https://scontent.cdninstagram.com/small.mp4", width: 720, height: 1280, type: 101 }],
    images: [],
    ...patch,
  };
}

test("formats names and the day a story was posted", () => {
  assert.equal(formatDay(takenAt), "2026-01-02");
  assert.equal(postedDayFromTitle("Oct 29, 2026"), "2026-10-29");
  assert.equal(postedDayFromTitle("October 29, 2026"), "2026-10-29");
  assert.equal(sanitizeName("../nope"), "nope");
  assert.equal(sanitizeName(".."), "instagram");
  const filename = storyFilename("Ada", takenAt, "555", "mp4");
  assert.equal(filename, "StorySaverPlus/Ada 2026-01-02 555.mp4");
  assert.equal(filenameWithPostedDay(filename, "2026-10-29"), "StorySaverPlus/Ada 2026-10-29 555.mp4");
  assert.equal(isSafeDownloadPath(filename), true);
  const played = storyFilename("Ada", null, "1080x1920", "mp4", "2026-10-29");
  const facts = { width: 1080, height: 1920, frameRate: 30, audioKbps: 128 };
  const detailed = qualitySuffix(facts);
  assert.equal(detailed, "1080x1920 30fps 128kbps");
  assert.equal(qualityLabel(facts), "1080×1920 · 30 fps · 128 kbps audio");
  assert.equal(filenameWithQuality(played, detailed), "StorySaverPlus/Ada 2026-10-29 1080x1920 30fps 128kbps.mp4");
  assert.equal(filenameWithQuality(filename, detailed), filename);
  const story = filenameWithMark(played, filenameMark({ storyId: "37829415601234567", highlightId: null, panelIndex: null }));
  assert.equal(filenameWithQuality(story, detailed), "StorySaverPlus/Ada 2026-10-29 1080x1920 30fps 128kbps [3782].mp4");
  const highlight = filenameWithMark(played, filenameMark({ storyId: null, highlightId: "1805432199", panelIndex: 2 }));
  assert.equal(filenameWithQuality(highlight, detailed), "StorySaverPlus/Ada 2026-10-29 1080x1920 30fps 128kbps [1805-3].mp4");
  assert.equal(filenameWithMark(storyFilename("Ada", takenAt, "37829415601234567", "mp4"), "3782"), "StorySaverPlus/Ada 2026-01-02 37829415601234567.mp4");
  assert.equal(isSafeDownloadPath("StorySaverPlus/../secret.mp4"), false);
});

test("plans a lossless mux of the best video and audio", () => {
  const plan = planDownload(media({}));
  assert.equal(plan.mode, "mux");
  assert.equal(plan.videoUrl, "https://scontent.cdninstagram.com/high.mp4");
  assert.equal(plan.audioUrl, "https://scontent.cdninstagram.com/a.m4a");
  assert.equal(plan.progressiveUrl, "https://scontent.cdninstagram.com/small.mp4");
  assert.equal(plan.label, "1080×1920 · 30 fps · 128 kbps audio");
  assert.equal(describeResult(plan, "mux"), "Saved 1080×1920 · 30 fps · 128 kbps audio.");
  assert.equal(savedMessage(plan, "mux", "1080×1920 · 30 fps · 128 kbps audio"), "Saved 1080×1920 · 30 fps · 128 kbps audio.");
  assert.match(describeResult(plan, "fallback"), /smaller file/);
});

test("plans a silent story from video with no audio representation", () => {
  const silent = manifest.split("<AdaptationSet mimeType=\"audio/mp4\">")[0] ?? "";
  const plan = planDownload(media({ dashManifest: silent }));
  assert.equal(plan.mode, "silent");
  assert.equal(plan.url, "https://scontent.cdninstagram.com/high.mp4");
  assert.equal(describeResult(plan, "silent"), "This story has no audio. Saved 1080×1920 · 30 fps.");
});

test("plans the largest photo", () => {
  const plan = planDownload(media({
    kind: "photo",
    dashManifest: null,
    videoVersions: [],
    images: [
      { url: "https://scontent.cdninstagram.com/small.jpg", width: 100, height: 100 },
      { url: "https://scontent.cdninstagram.com/large.jpg", width: 1080, height: 1920 },
    ],
  }));
  assert.equal(plan.mode, "photo");
  assert.equal(plan.url, "https://scontent.cdninstagram.com/large.jpg");
  assert.equal(plan.filename.endsWith(".jpg"), true);
});

test("accepts only signed media URLs from Instagram hosts", () => {
  const filename = storyFilename("Ada", takenAt, "555", "mp4");
  const accepted = parseSaveRequest({
    type: "save",
    token: 1,
    filename,
    mode: "mux",
    url: null,
    videoUrl: "https://scontent-hel3-1.cdninstagram.com/v.mp4",
    audioUrl: "https://video.xx.fbcdn.net/a.m4a",
    progressiveUrl: null,
  });
  assert.equal(accepted?.videoUrl, "https://scontent-hel3-1.cdninstagram.com/v.mp4");
  assert.equal(parseSaveRequest({
    type: "save",
    token: 1,
    filename,
    mode: "silent",
    url: "https://evil.example/v.mp4",
    videoUrl: null,
    audioUrl: null,
    progressiveUrl: null,
  }), null);
  assert.equal(parseSaveRequest({
    type: "save",
    token: 1,
    filename: "../x.mp4",
    mode: "silent",
    url: "https://scontent.cdninstagram.com/v.mp4",
  }), null);
});
