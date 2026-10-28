import assert from "node:assert/strict";
import test from "node:test";
import { describePageStatus, isInstagramPage, storyCanSave, TOOLBAR_NEEDS_RELOAD } from "../src/lib/status.ts";

test("names Instagram pages the toolbar can reach", () => {
  assert.equal(isInstagramPage("https://www.instagram.com/stories/ada/"), true);
  assert.equal(isInstagramPage("https://instagram.com/"), true);
  assert.equal(isInstagramPage("https://example.com/"), false);
  assert.equal(isInstagramPage(undefined), false);
});

test("asks for a reload when the page hook never starts", () => {
  assert.equal(
    describePageStatus({ pathname: "/", hookReady: false, hookTimedOut: true, mediaCount: 0 }),
    TOOLBAR_NEEDS_RELOAD,
  );
});

test("says which page is open when it is not a story", () => {
  assert.equal(describePageStatus({ pathname: "/", hookReady: true, hookTimedOut: false, mediaCount: 0 }), "Open a story to save it. This page is /.");
});

test("shows the ready icon only when a story can be saved", () => {
  assert.equal(storyCanSave({ pathname: "/", owner: null, busy: false }), false);
  assert.equal(storyCanSave({ pathname: "/stories/Ada/", owner: null, busy: false }), true);
  assert.equal(storyCanSave({ pathname: "/stories/Ada/", owner: null, busy: true }), false);
  assert.equal(storyCanSave({ pathname: "/stories/highlights/1789/", owner: null, busy: false }), false);
  assert.equal(storyCanSave({ pathname: "/stories/highlights/1789/", owner: "Ada", busy: false }), true);
});

test("names the account and how many stories were loaded", () => {
  assert.equal(
    describePageStatus({ pathname: "/stories/Ada/", hookReady: true, hookTimedOut: false, mediaCount: 0 }),
    "Ready for @Ada.",
  );
  assert.equal(
    describePageStatus({ pathname: "/stories/Ada/", hookReady: true, hookTimedOut: false, mediaCount: 2 }),
    "Ready for @Ada. 2 stories loaded.",
  );
  assert.equal(
    describePageStatus({ pathname: "/stories/highlights/17890000000000000/", hookReady: true, hookTimedOut: false, mediaCount: 0, owner: "Ada" }),
    "Ready for highlight by @Ada.",
  );
  assert.equal(
    describePageStatus({ pathname: "/stories/highlights/17890000000000000/", hookReady: true, hookTimedOut: false, mediaCount: 0 }),
    "Loading highlight…",
  );
});
