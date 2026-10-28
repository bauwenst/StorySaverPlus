import assert from "node:assert/strict";
import test from "node:test";
import { activeIndexFromFills, panelIndexFromBars, parseStoryLocation, selectCurrent, usernameFromProfilePath } from "../src/lib/select.ts";
import type { MediaRecord, Reel } from "../src/lib/types.ts";

function video(id: string, duration: number): MediaRecord {
  return {
    id,
    username: "Ada",
    takenAt: 1761700000,
    kind: "video",
    duration,
    dashManifest: null,
    videoVersions: [],
    images: [],
  };
}

const first = video("11111", 4);
const second = video("22222", 9);
const byId = new Map<string, MediaRecord>([
  [first.id, first],
  [second.id, second],
]);
const reels = new Map<string, Reel>([
  ["user:ada", { key: "user:ada", username: "Ada", itemIds: [first.id, second.id] }],
  ["highlight:77", { key: "highlight:77", username: "Ada", itemIds: [second.id, first.id] }],
]);

test("reads a profile link and skips Instagram's own pages", () => {
  assert.equal(usernameFromProfilePath("/Ada/"), "Ada");
  assert.equal(usernameFromProfilePath("/stories/"), null);
  assert.equal(usernameFromProfilePath("/explore/"), null);
  assert.equal(usernameFromProfilePath("/Ada/reels/"), null);
});

test("parses story and highlight URLs", () => {
  assert.deepEqual(parseStoryLocation("/stories/Ada/22222/"), {
    kind: "story",
    username: "Ada",
    highlightId: null,
    mediaId: "22222",
  });
  assert.deepEqual(parseStoryLocation("/stories/highlights/77/11111"), {
    kind: "highlight",
    username: null,
    highlightId: "77",
    mediaId: "11111",
  });
  assert.equal(parseStoryLocation("/p/abc").kind, null);
  assert.equal(parseStoryLocation("/stories/highlights").kind, null);
});

test("trusts the story id in the URL", () => {
  const selected = selectCurrent({
    pathname: "/stories/Ada/22222",
    byId,
    reels,
    progressIndex: 0,
    videoDuration: 4,
  });
  assert.equal(selected?.id, "22222");
});

test("does not substitute another story when the URL id is missing from the cache", () => {
  const selected = selectCurrent({
    pathname: "/stories/Ada/33333",
    byId,
    reels,
    progressIndex: 0,
    videoDuration: 4,
  });
  assert.equal(selected, null);
});

test("uses the progress bar, then the playing video length when they disagree", () => {
  const fromBar = selectCurrent({
    pathname: "/stories/ada",
    byId,
    reels,
    progressIndex: 0,
    videoDuration: 4.1,
  });
  assert.equal(fromBar?.id, "11111");

  const fromLength = selectCurrent({
    pathname: "/stories/ada",
    byId,
    reels,
    progressIndex: 0,
    videoDuration: 9,
  });
  assert.equal(fromLength?.id, "22222");
});

test("reads highlight order from the highlight reel", () => {
  const selected = selectCurrent({
    pathname: "/stories/highlights/77",
    byId,
    reels,
    progressIndex: 0,
    videoDuration: null,
  });
  assert.equal(selected?.id, "22222");
});

test("panel index is the only bar that contains the progress", () => {
  assert.equal(panelIndexFromBars([false, false, true, false]), 2);
  assert.equal(panelIndexFromBars([false, false, false]), null);
  assert.equal(panelIndexFromBars([true, true]), null);
});

test("progress index follows the rightmost bar that has started", () => {
  assert.equal(activeIndexFromFills([0, 0, 0]), 0);
  assert.equal(activeIndexFromFills([1, 0.4, 0]), 1);
  assert.equal(activeIndexFromFills([1, 1, 0]), 1);
  assert.equal(activeIndexFromFills([1, 1, 1]), 2);
  assert.equal(activeIndexFromFills([]), null);
});
