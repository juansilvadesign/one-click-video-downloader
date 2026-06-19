# One-Click Video Downloader Backlog

**Last reviewed:** 2026-06-19  
**Current release:** MVP `0.1.0`

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
| OCVD-001 | P0 | Controllable native jobs and live-stream mode | Planned |
| OCVD-002 | P0 | Network resilience and dependency preflight | Planned |
| OCVD-003 | P1 | Codec-aware selective transcoding | Planned |
| OCVD-004 | P1 | Optional yt-dlp page fallback | Planned |
| OCVD-005 | P2 | In-memory HLS manifest detection | Conditional |
| OCVD-006 | P2 | Prevent system sleep during native jobs | Planned |

## P0 — Reliability and control

### OCVD-001 — Controllable native jobs and live-stream mode

**Outcome:** Native FFmpeg work remains controllable after it starts, including streams with no finite duration.

**Why:** The current native host processes one download synchronously. It cannot read a cancel message while FFmpeg is running, and a live HLS manifest can therefore become an unbounded job.

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

- [ ] The host can receive and acknowledge a stop/cancel message while FFmpeg is active.
- [ ] Stopping a live recording produces a playable MP4 containing both available media streams.
- [ ] Canceling a VOD job leaves no misleading completed file.
- [ ] Popup state differentiates `running`, `recording`, `stopping`, `canceled`, `complete`, and `error`.
- [ ] Closing the popup does not stop the job; reopening it restores the active state.
- [ ] Windows and Linux tests exercise graceful stop and forced-termination fallback.

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

- [ ] Missing `ffprobe` is detected before the user starts a download.
- [ ] One injected connection drop recovers without user action.
- [ ] Permanent `401`, `403`, and malformed-manifest failures do not loop indefinitely.
- [ ] Popup feedback shows the retry attempt without revealing the media URL.
- [ ] Retry limits and delays are covered by deterministic tests.

**References:**

- [FFandown timeout and reconnect options](../../sources/video-downloader-extension/ffandown/bin/core/index.js#L539)
- [M3u8Downloader_H bounded segment retries](../../sources/video-downloader-extension/M3u8Downloader_H/M3u8Downloader_H.Downloader/M3uDownloaders/M3u8Downloader.cs#L140)

## P1 — Better output and broader compatibility

### OCVD-003 — Codec-aware selective transcoding

**Outcome:** Compatible streams remain lossless and fast; only incompatible streams are transcoded.

**Why:** The current fallback retries with H.264 video and AAC audio together. An incompatible audio codec should not force a compatible high-quality video stream through a full encode.

**Scope:**

- Extend ffprobe output to include duration, codec type, codec name, resolution, channels, bitrate, and container.
- Define and test an explicit MP4 compatibility policy.
- Choose `copy` or transcode independently for video and audio.
- Preserve automatic highest-resolution selection for adaptive manifests.
- Keep a conservative full-transcode fallback only when selective handling fails.
- Do not copy bitstream-filter flags from references without container-specific fixtures.

**Acceptance criteria:**

- [ ] H.264 + AAC uses `-c:v copy -c:a copy`.
- [ ] H.264 + incompatible audio copies video and transcodes only audio to AAC.
- [ ] Incompatible video transcodes to H.264 while compatible audio remains copied when safe.
- [ ] Tests verify the chosen FFmpeg argument array and resulting codecs.
- [ ] Progress messaging states whether the job is remuxing or transcoding.

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

- [ ] A page with no detected media can produce a fallback job when yt-dlp supports it.
- [ ] Unsupported pages return a concise error without changing the normal detector path.
- [ ] Playlists are not downloaded accidentally.
- [ ] Cookie access is disabled by default and clearly surfaced when requested.
- [ ] Temporary cookie files are removed after success, error, cancellation, and host termination.
- [ ] Installation and upgrade documentation preserves the production `.venv` rule.

**References:**

- [Elephant yt-dlp and cookie handoff](../../sources/video-downloader-extension/elephant/plugin/msabstractparser.js#L36)
- [Media Downloader yt-dlp capability definition](../../sources/video-downloader-extension/media-downloader/extensions/yt-dlp.json)

## P2 — Conditional detection and ergonomics

### OCVD-005 — In-memory HLS manifest detection

**Outcome:** Recover HLS manifests constructed entirely inside the page when `webRequest` cannot observe a usable manifest URL.

**Activation condition:** Implement only after an authorized reproducible page fails normal detection and yt-dlp fallback is unsuitable.

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

- [ ] A fixture-created HLS Blob is detected only after the optional capability is enabled.
- [ ] Normal pages incur no main-world injection.
- [ ] Relative segments and key URLs resolve correctly.
- [ ] Oversized or malformed payloads are rejected before reaching FFmpeg.
- [ ] The feature adds no remote code and leaks no manifest content to page scripts.

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

- [ ] Starting the first native job requests system wakefulness.
- [ ] Completing the final native job releases it exactly once.
- [ ] Every error/cancel/disconnect path releases the request.
- [ ] Direct MP4 browser downloads do not request wakefulness.
- [ ] Mocked extension tests cover overlapping job-state transitions.

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

- [ ] Existing direct MP4, HLS, DASH, and split-track tests still pass.
- [ ] New Python tests run through the project `.venv`.
- [ ] Production behavior runs through the installed production `.venv`.
- [ ] Native commands remain argument arrays with no shell execution.
- [ ] Signed URLs, cookies, and authorization headers remain redacted.
- [ ] Windows Chrome installation or upgrade instructions are updated.
- [ ] The optional localhost HTTP smoke test covers the new native behavior where applicable.
- [ ] A manual Windows Chrome smoke test passes before marking the item complete.

