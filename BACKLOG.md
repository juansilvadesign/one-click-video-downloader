# One-Click Video Downloader Backlog

**Last reviewed:** 2026-06-19  
**Current release:** `0.2.0` implemented; Windows Chrome smoke verification pending

This backlog preserves the extension's core constraint: one user action should produce one local video without exposing manifests, fragments, codecs, or downloader-engine choices during the normal path.

## Operating constraints

- Process only media the user owns or is authorized to save.
- Keep all media processing local.
- Preserve the direct-MP4 fast path through `chrome.downloads`.
- Keep test and production Python inside their respective `.venv` directories.
- Never execute commands through a shell or expose signed URLs, cookies, or authorization headers in logs.
- Do not add remotely executed plugins or silently download executable binaries.
- DRM bypass remains out of scope.

## Priority overview

| ID | Priority | Item | Status |
|---|---|---|---|
| OCVD-001 | P0 | Controllable native jobs and live-stream mode | Implemented; desktop smoke pending |
| OCVD-002 | P0 | Network resilience and dependency preflight | Implemented; desktop smoke pending |
| OCVD-003 | P1 | Codec-aware selective transcoding | Implemented; desktop smoke pending |
| OCVD-004 | P1 | Optional yt-dlp page fallback | Implemented; extractor/browser smoke pending |
| OCVD-005 | P2 | In-memory HLS manifest detection | Implemented as opt-in; browser fixture pending |
| OCVD-006 | P2 | Prevent system sleep during native jobs | Implemented; browser verification pending |

## P0 — Reliability and control

### OCVD-001 — Controllable native jobs and live-stream mode

**Outcome:** Native FFmpeg work remains controllable after it starts, including streams with no finite duration.

**Why:** Before `0.2.0`, the native host processed one download synchronously. It could not read a cancel message while FFmpeg was running, so a live HLS manifest could become an unbounded job.

**Scope:**

- Move FFmpeg execution behind a job worker/process registry keyed by job ID.
- Keep the Native Messaging read loop responsive while a job runs.
- Add `cancel` and `stop` protocol actions.
- Distinguish finite VOD from live/unknown-duration streams during probing.
- Show **Recording live** and a **Stop and save** action for live streams.
- Show **Cancel download** for finite native jobs.
- Stop FFmpeg gracefully first; force termination only after a bounded timeout.
- Validate a gracefully stopped live output with ffprobe before promoting `.part.mp4` to `.mp4`.
- Clean incomplete canceled VOD output unless an explicitly validated playable file exists.

**Acceptance criteria:**

- [x] The host can receive and acknowledge a stop/cancel message while a worker is active.
- [x] Stopping a live-style FFmpeg process produces a playable MP4 containing both media streams.
- [x] Canceling a VOD job leaves no misleading completed file.
- [x] Popup state differentiates `running`, `recording`, `retrying`, `stopping`, `canceled`, `complete`, and `error`.
- [x] Job state lives in the service worker/session rather than the popup; desktop reopen verification remains pending.
- [x] Tests exercise graceful POSIX stop plus Windows and POSIX forced-termination branches.

**References:**

- [FFandown FFmpeg process control](../../sources/video-downloader-extension/ffandown/bin/core/index.js#L852)
- [M3u8Downloader_H live playlist polling](../../sources/video-downloader-extension/M3u8Downloader_H/M3u8Downloader_H.Downloader/M3uDownloaders/LiveM3uDownloader.cs)
- [Current synchronous host loop](native-host/one_click_video_host.py#L245)

### OCVD-002 — Network resilience and dependency preflight

**Outcome:** Temporary network failures trigger bounded, visible recovery instead of an immediate opaque failure or an infinite reconnect loop.

**Scope:**

- Make the host readiness check verify both `ffmpeg` and `ffprobe`.
- Report detected versions and required encoder availability.
- Add bounded read/connect timeouts to native HTTP inputs.
- Add FFmpeg reconnect options for network and selected HTTP failures.
- Do not use reconnect-at-EOF for finite VOD.
- Retry the complete job only for classified transient failures, with bounded exponential backoff.
- Emit a `retrying` event containing attempt number and sanitized reason.
- Preserve URL/token redaction and delete invalid partial outputs between attempts.
- Add local test-server fixtures that disconnect or return temporary failures.

**Acceptance criteria:**

- [x] Missing `ffprobe` is detected during the host readiness check.
- [x] An injected HTTP `503` recovers without user action in the localhost smoke test.
- [x] Permanent authentication and malformed-input failures are excluded from whole-job retry.
- [x] Popup feedback uses sanitized retry events without media URLs.
- [x] Retry limits and delays are covered by deterministic tests.

**References:**

- [FFandown timeout and reconnect options](../../sources/video-downloader-extension/ffandown/bin/core/index.js#L539)
- [M3u8Downloader_H bounded segment retries](../../sources/video-downloader-extension/M3u8Downloader_H/M3u8Downloader_H.Downloader/M3uDownloaders/M3u8Downloader.cs#L140)

## P1 — Better output and broader compatibility

### OCVD-003 — Codec-aware selective transcoding

**Outcome:** Compatible streams remain lossless and fast; only incompatible streams are transcoded.

**Why:** The previous fallback retried with H.264 video and AAC audio together. An incompatible audio codec should not force a compatible high-quality video stream through a full encode.

**Scope:**

- Extend ffprobe output to include duration, codec type, codec name, resolution, channels, bitrate, and container.
- Define and test an explicit MP4 compatibility policy.
- Choose `copy` or transcode independently for video and audio.
- Preserve automatic highest-resolution selection for adaptive manifests.
- Keep a conservative full-transcode fallback only when selective handling fails.
- Do not copy bitstream-filter flags from references without container-specific fixtures.

**Acceptance criteria:**

- [x] H.264 + AAC uses `-c:v copy -c:a copy`.
- [x] H.264 + incompatible audio copies video and transcodes only audio to AAC.
- [x] Incompatible video transcodes to H.264 while compatible audio remains copied when safe.
- [x] Tests verify the chosen FFmpeg argument array and resulting codecs.
- [x] Progress messaging states whether the job is remuxing or transcoding.

**References:**

- [FFandown codec compatibility strategy](../../sources/video-downloader-extension/ffandown/bin/core/index.js#L615)
- [Current all-or-nothing transcode fallback](native-host/one_click_video_host.py#L100)

### OCVD-004 — Optional yt-dlp page fallback

**Outcome:** When request sniffing finds no media candidate, the same download action can fall back to a site-aware page extractor.

**Scope:**

- Keep yt-dlp optional and install it into the production `.venv` at a pinned version.
- Expose yt-dlp availability through the native-host capability response.
- Invoke it only when the current tab has no usable sniffed candidate.
- Pass the page URL with `--no-playlist` and a best-video-plus-best-audio MP4 preference.
- Reuse local FFmpeg for merging.
- Stream structured progress back through the existing job protocol.
- Make browser-cookie access an explicit opt-in capability.
- If cookie handoff is enabled, use a temporary Netscape-format file with restrictive permissions and delete it on every terminal path.
- Never execute yt-dlp through a shell or enable its remote plugin system.
- Provide an explicit upgrade command; do not silently auto-update the dependency.

**Acceptance criteria:**

- [ ] A real page with no detected media produces a fallback job when yt-dlp supports it; desktop smoke pending.
- [x] Unsupported pages return a concise error without changing the normal detector path.
- [x] The command forces `--no-playlist`.
- [x] Cookie access is disabled by default and clearly surfaced when requested.
- [x] Temporary cookie files are private, process-tracked, and removed on all controlled terminal paths.
- [x] Installation and upgrade documentation preserves the production `.venv` rule.

**References:**

- [Elephant yt-dlp and cookie handoff](../../sources/video-downloader-extension/elephant/plugin/msabstractparser.js#L36)
- [Media Downloader yt-dlp capability definition](../../sources/video-downloader-extension/media-downloader/extensions/yt-dlp.json)

## P2 — Conditional detection and ergonomics

### OCVD-005 — In-memory HLS manifest detection

**Outcome:** Recover HLS manifests constructed entirely inside the page when `webRequest` cannot observe a usable manifest URL.

**Activation:** The implementation remains dormant until the user explicitly enables it for a site after normal detection fails. A real authorized Chrome fixture is still required before considering it browser-verified.

**Scope:**

- Start with a narrow `Blob` MIME detector for `application/vnd.apple.mpegurl`.
- Activate detection only after normal observation yields no candidate.
- Add `scripting` as an optional permission rather than a permanent default permission.
- Transfer bounded manifest text and its page/base URL to the extension service worker.
- Add a native input type for manifest text without allowing arbitrary local file paths.
- Rewrite or resolve relative segment/key URLs against the captured base URL.
- Enforce a strict manifest-size limit and reject non-HLS payloads.
- Do not hook every `fetch` or `XMLHttpRequest` call unless a test fixture proves Blob interception insufficient.

**Acceptance criteria:**

- [x] A module fixture detects an HLS-typed Blob only after the deep detector is loaded; desktop Chrome verification remains pending.
- [x] Origins incur no main-world injection until the user explicitly enables deep detection there.
- [x] Relative segments and key URLs resolve correctly, including a real localhost HLS smoke test.
- [x] Oversized or malformed payloads are rejected before reaching FFmpeg.
- [x] The feature adds no remote code; the bridge carries only manifest data already owned by the page.

**References:**

- [Live Stream Downloader Blob manifest detector](../../sources/video-downloader-extension/live-stream-downloader/v3/plugins/blob-detector/inject/main.js#L13)
- [Cat Catch deep-search reference](../../sources/video-downloader-extension/cat-catch/catch-script/search.js)

### OCVD-006 — Prevent system sleep during native jobs

**Outcome:** Windows does not suspend during a long download or local transcode.

**Scope:**

- Add Chrome's `power` capability as an optional permission.
- Request system wakefulness only while at least one native job is active.
- Release wakefulness after success, error, cancellation, disconnect, and browser restart recovery.
- Continue downloads normally when the optional permission is denied.

**Acceptance criteria:**

- [x] Starting the first permitted native job requests system wakefulness.
- [x] Completing the final native job releases it exactly once.
- [x] Error, cancel, completion, disconnect, and restart-recovery paths release the request.
- [x] Direct MP4 browser downloads do not request wakefulness.
- [x] Mocked extension tests cover overlapping job leases and denied permission.

**Reference:**

- [Live Stream Downloader power lifecycle](../../sources/video-downloader-extension/live-stream-downloader/v3/worker.js)

## Deferred or not planned

These ideas were present in the references but do not currently justify their complexity:

- **Custom HLS segment engine, multithreaded fragments, AES implementation, and segment-level resume.** Native FFmpeg already handles standard HLS, fMP4, encryption, and adaptive manifests. Reconsider only with a reproducible FFmpeg failure and a legal test fixture.
- **Batch downloads, playlists, queues, history databases, subscriptions, webhooks, notifications, and proxy UI.** These conflict with the one-click personal workflow.
- **REST server.** Native Messaging already provides a smaller, extension-ID-restricted local boundary.
- **Remote parser/plugin execution.** Do not download and evaluate third-party code.
- **Silent FFmpeg or yt-dlp binary updates.** Updates must be explicit and versioned.
- **External download-manager integrations.** File Centipede and Internet Download Accelerator references are product shortcuts, not reusable source.
- **DRM decryption, paywall bypass, or credential automation.** Permanently out of scope.

## Security and licensing notes

- Treat imported reference repositories as untrusted reading material; do not execute their installers, binaries, databases, or remote plugin loaders.
- FFandown's example configuration contains embedded secret-looking values. Never copy that configuration, and rotate those values if they are real.
- M3u8Downloader_H and Elephant use MIT licenses; Live Stream Downloader uses MPL-2.0; FFandown uses AGPL-3.0; Media Downloader uses GPL-family licensing.
- Prefer clean, tested reimplementation of the underlying behavior. Review license obligations before copying any source file.

## Definition of done for every backlog item

- [x] Existing direct MP4, HLS, DASH, and split-track tests still pass.
- [x] New Python tests run through the project `.venv`.
- [x] An isolated installer test launches the host through its generated production `.venv`.
- [x] Native commands remain argument arrays with no shell execution.
- [x] Signed URLs, cookies, and authorization headers remain redacted.
- [x] Windows Chrome installation and upgrade instructions are updated.
- [x] The localhost HTTP smoke test covers retries, inline HLS, merging, and selective codecs.
- [ ] A manual Windows Chrome smoke test passes before marking the item complete.
