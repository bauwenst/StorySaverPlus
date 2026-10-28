# Story Saver Plus

A Chrome extension that saves the Instagram story you are watching. Video is saved from Instagram's highest-resolution, highest-frame-rate stream, then the best audio stream is joined in without re-encoding. Photos are saved at the largest size Instagram sends.

Everything happens in the browser. The extension does not upload stories anywhere. It can only save a story your signed-in Instagram session can already play.

## Install

```bash
npm install
npm run build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the `dist` folder.

## Use

1. Open a story or highlight on instagram.com while you are logged in.
2. Click the download button at the top-right of the page, the extension icon, or press Alt+Shift+S.
3. The file is saved under `Downloads/StorySaverPlus/`.

A video toast looks like `Saved 1080×1920 · 30 fps · 128 kbps audio.` That resolution and frame rate are the top video stream. The audio figure is the top audio stream. If a story was posted without sound, the toast says so. If the two streams cannot be combined, the extension saves Instagram's smaller combined file instead and says that it did.

## Quality

Instagram plays stories from a DASH manifest: one video-only file (often VP9 at the original resolution and frame rate) and a separate audio file (AAC). Saving only the video file is sharp and silent. This extension copies both tracks into one MP4, so the picture is not recompressed.

The video codec is whatever Instagram used for that top stream. VLC, mpv, Chrome, and recent system players play it. QuickTime may not play VP9 video.

## Notes

Save stories you have the right to keep. Instagram can change its page and break this; `npm test` covers manifest parsing and story selection, not a live account.
