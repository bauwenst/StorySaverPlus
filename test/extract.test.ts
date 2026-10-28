import assert from "node:assert/strict";
import test from "node:test";
import { ingestJson } from "../src/lib/extract.ts";

const manifest = `<AdaptationSet mimeType="video/mp4"><Representation bandwidth="1000" width="1080" height="1920" frameRate="30" codecs="vp09.00.31.08"><BaseURL>https://scontent.cdninstagram.com/v.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000" codecs="mp4a.40.2"><BaseURL>https://scontent.cdninstagram.com/a.m4a</BaseURL></Representation></AdaptationSet>`;

test("reads a story reel and keeps the string media id", () => {
  const result = ingestJson({
    reels_media: [
      {
        id: "42",
        expiring_at: 1700000000,
        user: { pk: "42", username: "Ada" },
        items: [
          {
            pk: 123,
            id: "3456789012345678901_42",
            media_type: 2,
            taken_at: 1761700000,
            video_duration: 5.1,
            video_dash_manifest: manifest,
            video_versions: [{ url: "https://scontent.cdninstagram.com/p.mp4", width: 720, height: 1280, type: 101 }],
          },
          {
            id: "55555_42",
            media_type: 1,
            image_versions2: {
              candidates: [
                { url: "https://scontent.cdninstagram.com/small.jpg", width: 100, height: 100 },
                { url: "https://scontent.cdninstagram.com/large.jpg", width: 1080, height: 1920 },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(result.reels.map((reel) => reel.key).sort(), ["id:42", "user:ada"]);
  assert.deepEqual(result.reels[0]?.itemIds, ["3456789012345678901", "55555"]);
  assert.equal(result.media[0]?.kind, "video");
  assert.equal(result.media[0]?.id, "3456789012345678901");
  assert.equal(result.media[0]?.duration, 5.1);
  assert.equal(result.media[1]?.kind, "photo");
  assert.equal(result.users[0]?.username, "Ada");
  assert.equal(result.users[0]?.id, "42");
});

test("reads highlights and camel-case fields", () => {
  const result = ingestJson({
    id: "highlight:77",
    user: { username: "Ada", id: "42" },
    items: [
      {
        id: "88888_42",
        mediaType: 1,
        imageVersions2: {
          candidates: [{ url: "https://scontent.cdninstagram.com/h.jpg", width: 50, height: 50 }],
        },
      },
    ],
  });
  assert.equal(result.reels.length, 1);
  assert.equal(result.reels[0]?.key, "highlight:77");
  assert.equal(result.media[0]?.kind, "photo");
  assert.equal(result.media[0]?.images[0]?.url, "https://scontent.cdninstagram.com/h.jpg");
});

test("reads story data that arrived as a JSON string", () => {
  const payload = JSON.stringify({
    reels_media: [
      {
        id: "9",
        expiring_at: 1,
        user: { username: "sam", id: "9" },
        items: [
          {
            id: "55555_9",
            media_type: 1,
            image_versions2: {
              candidates: [{ url: "https://scontent.cdninstagram.com/z.jpg", width: 9, height: 9 }],
            },
          },
        ],
      },
    ],
  });
  const result = ingestJson({ payload });
  assert.equal(result.media[0]?.id, "55555");
  assert.equal(result.reels.some((reel) => reel.key === "user:sam"), true);
});

test("ignores a normal feed that is not a story reel", () => {
  const result = ingestJson({
    items: [
      {
        pk: "99999",
        id: "99999_1",
        media_type: 1,
        image_versions2: {
          candidates: [{ url: "https://scontent.cdninstagram.com/p.jpg", width: 100, height: 100 }],
        },
      },
    ],
  });
  assert.equal(result.media.length, 0);
  assert.equal(result.reels.length, 0);
});
