export type VideoVersion = {
  url: string;
  width: number;
  height: number;
  type: number;
};

export type ImageCandidate = {
  url: string;
  width: number;
  height: number;
};

export type MediaRecord = {
  id: string;
  username: string;
  takenAt: number | null;
  kind: "video" | "photo";
  duration: number | null;
  dashManifest: string | null;
  videoVersions: VideoVersion[];
  images: ImageCandidate[];
};

export type Reel = {
  key: string;
  username: string;
  itemIds: string[];
};

export type KnownUser = {
  username: string;
  id: string;
};

export type IngestResult = {
  media: MediaRecord[];
  reels: Reel[];
  users: KnownUser[];
};

export type StoryLocation = {
  kind: "story" | "highlight" | null;
  username: string | null;
  highlightId: string | null;
  mediaId: string | null;
};

export type DashStream = {
  kind: "video" | "audio";
  bandwidth: number;
  width: number;
  height: number;
  frameRate: number;
  sampleRate: number;
  codecs: string;
  url: string;
};

export type SaveMode = "photo" | "mux" | "silent" | "merged";

export type SaveUsed = SaveMode | "fallback" | "video";

export type SavePlan = {
  filename: string;
  mode: SaveMode;
  label: string;
  fallbackLabel: string | null;
  url: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  progressiveUrl: string | null;
};
