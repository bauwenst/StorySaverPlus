import { describeVideo, pickBestStreams } from "./dash";
import { extensionFromUrl, storyFilename } from "./filename";
import type { ImageCandidate, MediaRecord, SavePlan, SaveUsed, VideoVersion } from "./types";

function bestImage(images: ImageCandidate[]): ImageCandidate | null {
  return images.reduce<ImageCandidate | null>((best, image) => {
    if (!best) return image;
    return image.width * image.height > best.width * best.height ? image : best;
  }, null);
}

function bestProgressive(versions: VideoVersion[]): VideoVersion | null {
  return versions.reduce<VideoVersion | null>((best, version) => {
    if (!best) return version;
    const pixels = version.width * version.height;
    const bestPixels = best.width * best.height;
    if (pixels !== bestPixels) return pixels > bestPixels ? version : best;
    return version.type > best.type ? version : best;
  }, null);
}

export function planDownload(media: MediaRecord): SavePlan {
  const base = {
    filename: "",
    label: "",
    fallbackLabel: null as string | null,
    url: null as string | null,
    videoUrl: null as string | null,
    audioUrl: null as string | null,
    progressiveUrl: null as string | null,
  };

  if (media.kind === "photo") {
    const image = bestImage(media.images);
    if (!image) throw new Error("This photo story has no image file.");
    return {
      ...base,
      mode: "photo",
      filename: storyFilename(media.username, media.takenAt, media.id, extensionFromUrl(image.url)),
      label: `${image.width}×${image.height} photo`,
      url: image.url,
    };
  }

  const progressive = bestProgressive(media.videoVersions);
  const dash = media.dashManifest ? pickBestStreams(media.dashManifest) : { video: null, audio: null };
  const filename = storyFilename(media.username, media.takenAt, media.id, "mp4");
  const fallbackLabel = progressive ? `${progressive.width}×${progressive.height}` : null;

  if (dash.video && dash.audio) {
    return {
      ...base,
      mode: "mux",
      filename,
      label: describeVideo(dash.video, dash.audio),
      fallbackLabel,
      videoUrl: dash.video.url,
      audioUrl: dash.audio.url,
      progressiveUrl: progressive?.url ?? null,
    };
  }

  if (dash.video) {
    return {
      ...base,
      mode: "silent",
      filename,
      label: `${describeVideo(dash.video, null)}. This story has no audio`,
      url: dash.video.url,
    };
  }

  if (progressive) {
    return {
      ...base,
      mode: "merged",
      filename,
      label: `${progressive.width}×${progressive.height} video with audio`,
      url: progressive.url,
    };
  }

  throw new Error("This story has no video file.");
}

export function savedMessage(plan: SavePlan, used: SaveUsed, detail: string | null): string {
  if (plan.mode === "silent" || used === "silent") return describeResult(plan, "silent");
  if (used === "mux" && detail) return `Saved ${detail}.`;
  if (used === "merged" && plan.label.includes("without a separate audio file")) {
    return `Saved ${plan.label.replace(", without a separate audio file", " with audio")}.`;
  }
  return describeResult(plan, used);
}

export function describeResult(plan: SavePlan, used: SaveUsed): string {
  if (plan.mode === "silent" || used === "silent") {
    const size = plan.label.replace(/\. This story has no audio$/, "");
    return `This story has no audio. Saved ${size}.`;
  }
  if (used === "fallback") {
    const size = plan.fallbackLabel ?? "video";
    return `Saved ${size} with audio. The full-quality tracks could not be combined, so this is Instagram's smaller file.`;
  }
  if (used === "video") {
    const size = plan.fallbackLabel ?? "the video";
    return `Saved ${size} without audio. The separate audio track could not be added.`;
  }
  return `Saved ${plan.label}.`;
}
