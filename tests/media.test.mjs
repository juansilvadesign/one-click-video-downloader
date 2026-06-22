import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDownloadPlan,
  classifyMedia,
  qualityHint,
  sanitizeFilename,
  slugify
} from "../extension/media.js";

function candidate(overrides) {
  return {
    url: "https://media.example/video.mp4",
    kind: "video",
    format: "mp4",
    contentLength: 1_000,
    detectedAt: 1_000,
    quality: 0,
    ...overrides
  };
}

test("classifies adaptive manifests from URL and MIME metadata", () => {
  assert.deepEqual(
    classifyMedia({ url: "https://media.example/master.m3u8", contentType: "text/plain" }),
    { kind: "manifest", format: "hls" }
  );
  assert.deepEqual(
    classifyMedia({ url: "https://media.example/play", contentType: "application/dash+xml; charset=utf-8" }),
    { kind: "manifest", format: "dash" }
  );
});

test("ignores transport fragments while retaining direct media", () => {
  assert.equal(classifyMedia({ url: "https://media.example/segment-1.ts", contentType: "video/mp2t" }), null);
  assert.deepEqual(
    classifyMedia({ url: "https://media.example/file", contentType: "video/mp4" }),
    { kind: "video", format: "mp4" }
  );
});

test("prefers a master manifest over rendition and direct resources", () => {
  const plan = chooseDownloadPlan([
    candidate({ url: "https://media.example/video-1080.mp4", quality: 1080 }),
    candidate({ kind: "manifest", format: "hls", url: "https://media.example/720/index.m3u8", detectedAt: 3_000 }),
    candidate({ kind: "manifest", format: "hls", url: "https://media.example/master.m3u8", detectedAt: 2_000 })
  ]);
  assert.equal(plan.mode, "manifest");
  assert.equal(plan.inputs[0].url, "https://media.example/master.m3u8");
});

test("pairs the highest detected video with audio", () => {
  const plan = chooseDownloadPlan([
    candidate({ url: "https://media.example/video-720.mp4", quality: 720, contentLength: 5_000 }),
    candidate({ url: "https://media.example/video-1080.mp4", quality: 1080, contentLength: 4_000 }),
    candidate({ kind: "audio", url: "https://media.example/audio.m4a", detectedAt: 1_050 })
  ]);
  assert.equal(plan.mode, "merge");
  assert.match(plan.inputs[0].url, /1080/);
  assert.equal(plan.inputs[1].kind, "audio");
});

test("returns a direct plan when no separate audio is detected", () => {
  const plan = chooseDownloadPlan([candidate({ quality: 1080 })]);
  assert.equal(plan.mode, "direct");
  assert.match(plan.label, /1080p/);
});

test("routes non-MP4 direct video through local remuxing", () => {
  const plan = chooseDownloadPlan([candidate({ format: "webm", url: "https://media.example/video.webm" })]);
  assert.equal(plan.mode, "remux");
});

test("extracts quality hints and sanitizes output filenames", () => {
  assert.equal(qualityHint("https://example.test/video.mp4?height=1440"), 1440);
  assert.equal(qualityHint("https://example.test/assets/movie-1080p.mp4"), 1080);
  assert.equal(sanitizeFilename('  Lesson: 01 / Intro?  '), "Lesson 01 Intro");
});

test("slugify produces kebab-case filenames from page headings", () => {
  assert.equal(slugify("Showcase Video"), "showcase-video");
  assert.equal(slugify("  Lesson: 01 / Intro?  "), "lesson-01-intro");
  assert.equal(slugify("Showcase Video - YouTube"), "showcase-video-youtube");
  assert.equal(slugify("café déjà vu"), "café-déjà-vu");
  assert.equal(slugify(""), "video");
  assert.equal(slugify("***", "clip"), "clip");
  assert.equal(slugify("A".repeat(200)).length, 120);
});
