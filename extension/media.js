const HLS_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl"
]);

const DASH_TYPES = new Set(["application/dash+xml"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);
const AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "webm", "aac", "opus"]);
const SEGMENT_EXTENSIONS = new Set(["ts", "m4s", "cmfv", "cmfa"]);

export function normalizeContentType(value = "") {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function extensionFromUrl(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    const filename = pathname.split("/").pop() || "";
    const dot = filename.lastIndexOf(".");
    return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  } catch {
    return "";
  }
}

export function classifyMedia({ url, contentType = "", requestType = "" }) {
  const type = normalizeContentType(contentType);
  const extension = extensionFromUrl(url);

  if (extension === "m3u8" || HLS_TYPES.has(type)) {
    return { kind: "manifest", format: "hls" };
  }
  if (extension === "mpd" || DASH_TYPES.has(type)) {
    return { kind: "manifest", format: "dash" };
  }
  if (SEGMENT_EXTENSIONS.has(extension)) {
    return null;
  }
  if (type.startsWith("video/")) {
    return { kind: "video", format: extension || type.slice(6) || "unknown" };
  }
  if (type.startsWith("audio/")) {
    return { kind: "audio", format: extension || type.slice(6) || "unknown" };
  }
  if (VIDEO_EXTENSIONS.has(extension) && requestType === "media") {
    return { kind: "video", format: extension };
  }
  if (AUDIO_EXTENSIONS.has(extension) && requestType === "media") {
    return { kind: "audio", format: extension };
  }
  return null;
}

export function qualityHint(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const keys = ["height", "quality", "resolution", "res"];
    for (const key of keys) {
      const match = url.searchParams.get(key)?.match(/(\d{3,4})/);
      if (match) return Number(match[1]);
    }
    const pathMatch = url.pathname.match(/(?:^|[^\d])(2160|1440|1080|720|540|480|360|240)p?(?:[^\d]|$)/i);
    return pathMatch ? Number(pathMatch[1]) : 0;
  } catch {
    return 0;
  }
}

function candidateScore(candidate) {
  const quality = candidate.quality || qualityHint(candidate.url);
  const size = Number.isFinite(candidate.contentLength) ? candidate.contentLength : 0;
  return quality * 1_000_000_000 + size + (candidate.detectedAt || 0) / 1_000_000;
}

function manifestScore(candidate) {
  let score = candidate.detectedAt || 0;
  if (/master|manifest/i.test(candidate.url)) score += 10_000_000_000_000;
  if (candidate.format === "dash") score += 1_000_000;
  return score;
}

function best(candidates, score = candidateScore) {
  return [...candidates].sort((a, b) => score(b) - score(a))[0] || null;
}

export function chooseDownloadPlan(candidates = []) {
  const manifests = candidates.filter((candidate) => candidate.kind === "manifest");
  if (manifests.length) {
    const input = best(manifests, manifestScore);
    return {
      mode: "manifest",
      label: input.format === "dash" ? "DASH video" : "HLS video",
      inputs: [input]
    };
  }

  const video = best(candidates.filter((candidate) => candidate.kind === "video"));
  const audio = best(candidates.filter((candidate) => candidate.kind === "audio"));
  if (video && audio && Math.abs((video.detectedAt || 0) - (audio.detectedAt || 0)) <= 120_000) {
    return {
      mode: "merge",
      label: "Highest detected video + audio",
      inputs: [video, audio]
    };
  }
  if (video) {
    const isFinishedMp4 = video.format === "mp4" || video.format === "m4v";
    return {
      mode: isFinishedMp4 ? "direct" : "remux",
      label: video.quality
        ? `${isFinishedMp4 ? "Direct MP4" : "Video"} · ${video.quality}p`
        : isFinishedMp4 ? "Direct MP4" : "Video ready to remux",
      inputs: [video]
    };
  }
  return null;
}

export function sanitizeFilename(value, fallback = "video") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 160);
}

// Kebab-case slug for filenames, e.g. "Showcase Video" -> "showcase-video".
// Unicode-aware: letters/numbers from any script are kept so non-Latin titles
// are not erased to the fallback. Layered on top of sanitizeFilename, which the
// native host still applies as the final OS-safe-character pass.
export function slugify(value, fallback = "video") {
  const slug = String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
    .replace(/-+$/u, "");
  return slug || fallback;
}
