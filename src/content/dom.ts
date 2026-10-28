import { postedDayFromTitle } from "../lib/filename";
import { activeIndexFromFills, panelIndexFromBars, usernameFromProfilePath } from "../lib/select";

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function largestBox(selector: "video" | "img"): DOMRect | null {
  let best: DOMRect | null = null;
  let bestArea = 0;
  for (const element of document.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (rect.width < 80 || rect.height < 80 || area <= bestArea) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    best = rect;
    bestArea = area;
  }
  return best;
}

function nearStory(row: DOMRect, anchor: DOMRect): boolean {
  const overlap = Math.min(row.right, anchor.right) - Math.max(row.left, anchor.left);
  if (overlap < Math.min(row.width, anchor.width) * 0.4) return false;
  if (row.bottom > anchor.top + 36) return false;
  if (anchor.top - row.bottom > 90) return false;
  return true;
}

function fillRatio(bar: Element): number {
  const ratios: number[] = [];
  const nodes = [bar, ...bar.querySelectorAll("div")].slice(0, 8);
  for (const node of nodes) {
    if (node === bar) continue;
    const inline = node.getAttribute("style") ?? "";
    const scale = inline.match(/scaleX\(\s*([0-9.]+)\s*\)/);
    if (scale?.[1]) ratios.push(clamp(Number(scale[1])));
    const width = inline.match(/(?:^|[;\s])width:\s*([0-9.]+)%/);
    if (width?.[1]) ratios.push(clamp(Number(width[1]) / 100));
    const transform = getComputedStyle(node).transform;
    if (transform && transform !== "none") {
      const matrix = transform.match(/^matrix\(\s*([-0-9.]+)/);
      if (matrix?.[1]) ratios.push(clamp(Number(matrix[1])));
    }
  }
  const partial = ratios.find((ratio) => ratio > 0.02 && ratio < 0.98);
  if (partial != null) return partial;
  if (ratios.length > 0) return Math.max(...ratios);
  const inner = bar.firstElementChild;
  if (!inner) return 0;
  const parentWidth = bar.getBoundingClientRect().width;
  const innerWidth = inner.getBoundingClientRect().width;
  if (parentWidth <= 0) return 0;
  return clamp(innerWidth / parentWidth);
}

function largestElement(selector: "video" | "img"): HTMLVideoElement | HTMLImageElement | null {
  let best: HTMLVideoElement | HTMLImageElement | null = null;
  let bestArea = 0;
  for (const element of document.querySelectorAll(selector)) {
    if (!(element instanceof HTMLVideoElement || element instanceof HTMLImageElement)) continue;
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (rect.width < 80 || rect.height < 80 || area <= bestArea) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    best = element;
    bestArea = area;
  }
  return best;
}

function inStoryHeader(rect: DOMRect, anchor: DOMRect): boolean {
  const overlap = Math.min(rect.right, anchor.right) - Math.max(rect.left, anchor.left);
  if (overlap < 24) return false;
  const centerY = rect.top + rect.height / 2;
  return centerY >= anchor.top - 96 && centerY <= anchor.top + anchor.height * 0.35;
}

function columnRight(start: Element | null): number {
  let node = start instanceof HTMLElement ? start : null;
  let edge = 0;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.id !== "ssp-save" && node.id !== "ssp-hint" && node.id !== "ssp-toast") {
      const rect = node.getBoundingClientRect();
      if (rect.left <= 8 && rect.width >= 56 && rect.width <= 420 && rect.height >= window.innerHeight * 0.5) {
        edge = Math.max(edge, rect.right);
      }
    }
    node = node.parentElement;
  }
  return edge;
}

export function feedInset(): number {
  let edge = columnRight(document.elementFromPoint(4, Math.round(window.innerHeight / 2)));
  if (edge <= 0) {
    for (const nav of document.querySelectorAll("nav, [role='navigation']")) edge = Math.max(edge, columnRight(nav));
  }
  return edge > 0 ? Math.round(edge + 16) : 16;
}

export function storyOwnerName(): string | null {
  const anchor = largestBox("video") ?? largestBox("img");
  if (!anchor) return null;
  const best = { name: null as string | null, distance: Number.POSITIVE_INFINITY };
  const consider = (name: string | null, rect: DOMRect) => {
    if (!name || !inStoryHeader(rect, anchor)) return;
    const distance = Math.abs(rect.top + rect.height / 2 - anchor.top);
    if (distance < best.distance) {
      best.name = name;
      best.distance = distance;
    }
  };
  for (const link of document.querySelectorAll("a[href]")) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    consider(usernameFromProfilePath(link.pathname), link.getBoundingClientRect());
  }
  for (const image of document.querySelectorAll("img[alt]")) {
    if (!(image instanceof HTMLImageElement)) continue;
    const alt = image.alt.match(/^(.{1,30})'s profile picture$/i)?.[1] ?? null;
    consider(alt ? usernameFromProfilePath(`/${alt}/`) : null, image.getBoundingClientRect());
  }
  return best.name;
}

export function storyPostedDay(): string | null {
  const anchor = largestBox("video") ?? largestBox("img");
  if (!anchor) return null;
  let best: { day: string; distance: number } | null = null;
  for (const time of document.querySelectorAll("time")) {
    if (!(time instanceof HTMLTimeElement)) continue;
    const day = postedDayFromTitle(time.title) ?? postedDayFromTitle(time.dateTime);
    if (!day) continue;
    const rect = time.getBoundingClientRect();
    if (!inStoryHeader(rect, anchor)) continue;
    const distance = Math.abs(rect.top + rect.height / 2 - anchor.top);
    if (!best || distance < best.distance) best = { day, distance };
  }
  return best?.day ?? null;
}

export function playingSource(): {
  videoSrc: string | null;
  imageSrc: string | null;
  width: number;
  height: number;
} {
  const video = largestElement("video");
  if (video instanceof HTMLVideoElement) {
    const rect = video.getBoundingClientRect();
    return {
      videoSrc: video.currentSrc.startsWith("https://") ? video.currentSrc : null,
      imageSrc: null,
      width: video.videoWidth || Math.round(rect.width),
      height: video.videoHeight || Math.round(rect.height),
    };
  }
  const image = largestElement("img");
  if (!(image instanceof HTMLImageElement)) return { videoSrc: null, imageSrc: null, width: 0, height: 0 };
  const rect = image.getBoundingClientRect();
  return {
    videoSrc: null,
    imageSrc: image.currentSrc.startsWith("https://") ? image.currentSrc : null,
    width: image.naturalWidth || Math.round(rect.width),
    height: image.naturalHeight || Math.round(rect.height),
  };
}

export function visibleVideoDuration(): number | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const video of document.querySelectorAll("video")) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (rect.width < 80 || rect.height < 80 || area <= bestArea) continue;
    best = video;
    bestArea = area;
  }
  if (!best || !Number.isFinite(best.duration) || best.duration <= 0) return null;
  return best.duration;
}

function progressRow(): HTMLElement | null {
  const anchor = largestBox("video") ?? largestBox("img");
  if (!anchor) return null;
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const element of document.querySelectorAll("div")) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.childElementCount < 2 || element.childElementCount > 40) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 2 || rect.height > 16) continue;
    if (!nearStory(rect, anchor)) continue;
    const kids = [...element.children];
    const shaped = kids.every((kid) => {
      const kidRect = kid.getBoundingClientRect();
      return kidRect.height > 0 && kidRect.height <= 12 && kidRect.width > 0;
    });
    if (!shaped) continue;
    const distance = Math.abs(rect.bottom - anchor.top);
    if (distance < bestDistance) {
      best = element;
      bestDistance = distance;
    }
  }
  return best;
}

export function storyPanelIndex(): number | null {
  const row = progressRow();
  if (!row) return null;
  const children = [...row.children];
  const nested = panelIndexFromBars(children.map((child) => [...child.children].some((node) => node instanceof HTMLDivElement)));
  if (nested != null) return nested;
  return activeIndexFromFills(children.map((child) => fillRatio(child)));
}

export function storyProgressFills(): number[] | null {
  const row = progressRow();
  if (!row) return null;
  return [...row.children].map((child) => fillRatio(child));
}
