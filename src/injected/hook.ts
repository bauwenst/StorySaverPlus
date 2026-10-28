import { playingSource } from "../content/dom";
import { ingestJson, looksRelevant } from "../lib/extract";
import { PAGE_SOURCE, UI_SOURCE, type ContentToPage } from "../lib/messages";
import { isCdnUrl, playbackKind, type PlaybackFile } from "../lib/screen";
import type { IngestResult } from "../lib/types";

const MARK = "__storySaverPlus";

type MarkedWindow = Window & { [MARK]?: boolean };
type MarkedXhr = XMLHttpRequest & { __sspUrl?: string };

const WEB_APP_ID = "936619743392459";

function install(): void {
  const marked = window as MarkedWindow;
  if (marked[MARK]) return;
  marked[MARK] = true;
  console.info("[Story Saver Plus] watching Instagram responses");

  const originalFetch = window.fetch.bind(window);
  let wwwClaim = "0";
  const userIds = new Map<string, string>();
  const recent: IngestResult[] = [];
  const mediaSeen: PlaybackFile[] = [];

  function noteMedia(url: string, size: number): void {
    if (!isCdnUrl(url) || !playbackKind(url)) return;
    mediaSeen.push({ url, size: Number.isFinite(size) && size > 0 ? size : 0, at: performance.now() });
    if (mediaSeen.length > 80) mediaSeen.shift();
  }

  function playbackFiles(): PlaybackFile[] {
    const files: PlaybackFile[] = [];
    for (const entry of performance.getEntriesByType("resource")) {
      const timing = entry as PerformanceResourceTiming;
      if (!isCdnUrl(timing.name) || !playbackKind(timing.name)) continue;
      files.push({
        url: timing.name,
        size: timing.decodedBodySize || timing.encodedBodySize || timing.transferSize || 0,
        at: timing.startTime,
      });
    }
    files.push(...mediaSeen);
    return files.slice(-80);
  }

  function remember(result: IngestResult): void {
    if (result.media.length === 0 && result.reels.length === 0) return;
    recent.push(result);
    if (recent.length > 12) recent.shift();
    for (const user of result.users) userIds.set(user.username.toLowerCase(), user.id);
    window.postMessage({ source: PAGE_SOURCE, type: "media-batch", result }, location.origin);
  }

  function ingestValue(value: unknown): void {
    try {
      remember(ingestJson(value));
    } catch {
      return;
    }
  }

  function ingestText(text: string): void {
    if (!text || text.length > 5_000_000 || !looksRelevant(text)) return;
    try {
      ingestValue(JSON.parse(text) as unknown);
    } catch {
      return;
    }
  }

  function isApiUrl(url: string): boolean {
    if (!url.includes("instagram.com")) return false;
    return !/\.(?:mp4|m4a|m4s|jpg|jpeg|png|webp|mp3)(?:\?|$)/i.test(url);
  }

  function sameOrigin(url: string): boolean {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await originalFetch(input, init);
    try {
      const url = requestUrl(input);
      noteMedia(url, Number(response.headers.get("content-length") || 0));
      if (response.type === "basic") {
        const claim = response.headers.get("x-ig-set-www-claim");
        if (claim) wwwClaim = claim;
      }
      const type = response.headers.get("content-type") ?? "";
      if (isApiUrl(url) && (type.includes("json") || type.includes("text") || type.includes("javascript") || url.includes("/api/") || url.includes("graphql"))) {
        const copy = response.clone();
        void copy.text().then(ingestText).catch(() => undefined);
      }
    } catch {
      return response;
    }
    return response;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: MarkedXhr,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    this.__sspUrl = typeof url === "string" ? url : url.toString();
    xhrOpen.call(this, method, url, async ?? true, username, password);
  };

  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: MarkedXhr, ...args: unknown[]): void {
    this.addEventListener("load", () => {
      try {
        const url = this.__sspUrl || this.responseURL || "";
        try {
          noteMedia(url, Number(this.getResponseHeader("content-length") || 0));
        } catch {
          noteMedia(url, 0);
        }
        if (!isApiUrl(url)) return;
        if (sameOrigin(url)) {
          const claim = this.getResponseHeader("x-ig-set-www-claim");
          if (claim) wwwClaim = claim;
        }
        if (this.responseType === "json") ingestValue(this.response);
        else if (this.responseType === "" || this.responseType === "text") ingestText(this.responseText);
      } catch {
        return;
      }
    });
    return xhrSend.apply(this, args as unknown as [Document | XMLHttpRequestBodyInit | null | undefined]);
  };

  function cookie(name: string): string {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  async function igGet(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, location.origin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      Accept: "*/*",
      "X-IG-App-ID": WEB_APP_ID,
      "X-ASBD-ID": "129477",
      "X-IG-WWW-Claim": wwwClaim || "0",
      "X-Requested-With": "XMLHttpRequest",
    };
    const csrf = cookie("csrftoken");
    if (csrf) headers["X-CSRFToken"] = csrf;
    const response = await originalFetch(url, { credentials: "include", headers });
    const claim = response.headers.get("x-ig-set-www-claim");
    if (claim) wwwClaim = claim;
    if (response.status === 429) {
      throw new Error(
        "Instagram is rate-limiting this network (429). Wait before trying again. Reloading or saving again keeps the limit in place.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Log in to Instagram and open a story you can already watch.");
    }
    if (!response.ok) throw new Error(`Instagram returned an error (${response.status}).`);
    const data: unknown = await response.json();
    const status = data && typeof data === "object" && "status" in data ? (data as { status?: unknown }).status : null;
    if (status === "fail") throw new Error("Instagram did not return this story.");
    return data;
  }

  function profileId(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const user = (data as { data?: { user?: { id?: unknown; pk?: unknown } } }).data?.user;
    if (!user) return null;
    if (typeof user.id === "string" && /^[1-9]\d*$/.test(user.id)) return user.id;
    if (typeof user.pk === "string" && /^[1-9]\d*$/.test(user.pk)) return user.pk;
    return null;
  }

  async function loadReel(username: string | null, highlightId: string | null): Promise<void> {
    let reelId: string | null = null;
    if (highlightId) {
      if (!/^\d+$/.test(highlightId)) throw new Error("This highlight link is not one this extension understands.");
      reelId = `highlight:${highlightId}`;
    } else if (username) {
      reelId = userIds.get(username.toLowerCase()) ?? null;
      if (!reelId) {
        const profile = await igGet("/api/v1/users/web_profile_info/", { username });
        reelId = profileId(profile);
        if (!reelId) throw new Error("Could not find that account.");
        userIds.set(username.toLowerCase(), reelId);
      }
    } else {
      throw new Error("Open a story first.");
    }

    const data = await igGet("/api/v1/feed/reels_media/", { reel_ids: reelId });
    const result = ingestJson(data);
    if (result.media.length === 0) throw new Error("Instagram did not return this story. It may have expired.");
    remember(result);
  }

  let announced = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Partial<ContentToPage> | null;
    if (!data || data.source !== UI_SOURCE) return;
    if (data.type === "hello") {
      if (!announced) {
        announced = true;
        console.info("[Story Saver Plus] page hook answered");
      }
      for (const result of recent) {
        window.postMessage({ source: PAGE_SOURCE, type: "media-batch", result }, location.origin);
      }
      window.postMessage({ source: PAGE_SOURCE, type: "hello-ack" }, location.origin);
      return;
    }
    if (data.type === "read-playback" && typeof data.requestId === "string") {
      const requestId = data.requestId;
      const playing = playingSource();
      window.postMessage(
        {
          source: PAGE_SOURCE,
          type: "playback",
          requestId,
          videoSrc: playing.videoSrc,
          imageSrc: playing.imageSrc,
          width: playing.width,
          height: playing.height,
          files: playbackFiles(),
        },
        location.origin,
      );
      return;
    }
    if (data.type !== "load-reel" || typeof data.requestId !== "string") return;
    const requestId = data.requestId;
    void loadReel(data.username ?? null, data.highlightId ?? null)
      .then(() => {
        window.postMessage({ source: PAGE_SOURCE, type: "reel-loaded", requestId, ok: true }, location.origin);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Could not load this story.";
        window.postMessage(
          { source: PAGE_SOURCE, type: "reel-loaded", requestId, ok: false, error: message },
          location.origin,
        );
      });
  });
}

try {
  install();
} catch (error) {
  console.warn("[Story Saver Plus] could not watch Instagram responses", error);
}
