# One-Click Video Downloader Backlog

**Last reviewed:** 2026-06-22  
**Current release:** `0.2.0` released and manually verified in Windows Chrome

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
| OCVD-001 | P0 | Controllable native jobs and live-stream mode | Released |
| OCVD-002 | P0 | Network resilience and dependency preflight | Released |
| OCVD-003 | P1 | Codec-aware selective transcoding | Released |
| OCVD-004 | P1 | Optional yt-dlp page fallback | Released; extractor fixture pending |
| OCVD-005 | P2 | In-memory HLS manifest detection | Released as opt-in; real Blob site pending |
| OCVD-006 | P2 | Prevent system sleep during native jobs | Released |
| OCVD-007 | P0 | Correct Chrome lifecycle compatibility floor | Planned |
| OCVD-008 | P0 | Document-scoped candidate selection | Planned |
| OCVD-009 | P0 | FFmpeg protocol capability negotiation | Planned |
| OCVD-010 | P1 | Ambiguous media-response detection | Planned |
| OCVD-011 | P1 | Default audio and language-aware selection | Planned |
| OCVD-012 | P0 | Local browser compatibility fixture site | Planned |
| OCVD-013 | P1 | Explicit yt-dlp compatibility lifecycle | Planned |
| OCVD-014 | P2 | Portable playback and HDR policy | Conditional |
| OCVD-015 | P2 | Frame-aware deep detection | Conditional |
| OCVD-016 | P2 | Expired signed-URL reacquisition | Conditional |
| OCVD-017 | P2 | Auto-rename downloads from the page title/heading | Released |
| OCVD-018 | P1 | Concurrent local downloads | Released |

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

## Planned compatibility work

### OCVD-007 — Correct Chrome lifecycle compatibility floor

**Priority:** P0

**Outcome:** Every supported Chrome/Edge version keeps the Manifest V3 worker alive for the complete Native Messaging job.

**Why:** The manifest currently allows Chrome 102. Chrome only guarantees that `runtime.connectNative()` keeps an extension service worker alive from Chrome 105 onward. Document-scoped request IDs used by OCVD-008 are available from Chrome 106, so `106` is the honest minimum for the planned compatibility baseline.

**Scope:**

- Raise `minimum_chrome_version` to `106` and document the equivalent Edge requirement.
- Add a manifest test that rejects a lower compatibility floor.
- Add a browser-fixture job lasting longer than the normal service-worker idle timeout.
- Verify popup close/reopen while that native job remains active.
- Do not add timer-based keepalive traffic.

**Acceptance criteria:**

- [ ] Chrome/Edge below the declared floor cannot install the release.
- [ ] A native job longer than 30 seconds stays connected without artificial polling.
- [ ] Closing the popup does not affect the worker/native-host connection.
- [ ] Reopening the popup restores the same job ID and visible state.

**Reference:** [Chrome extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### OCVD-008 — Document-scoped candidate selection

**Priority:** P0

**Outcome:** Single-page navigation, advertisements, iframes, and multiple players cannot cause the extension to download or merge media from the wrong playback session.

**Why:** Candidates currently live at tab scope. SPA URL changes may not emit the exact `status: loading` combination used to clear state, and split-track pairing accepts any video/audio detected within two minutes. That can retain the previous route's video or pair tracks from unrelated players.

**Scope:**

- Store `documentId`, `frameId`, initiator, top-level URL, and navigation generation with each candidate.
- Clear or retire candidates on every top-level URL/document transition, including History API navigation.
- Group candidates by document/frame/playback session before choosing a plan.
- Never pair separate video/audio candidates across document or frame boundaries.
- Prefer the most recently active compatible group; retain the one-click UI.
- Define an explicit fallback for events where `documentId` is unavailable.

**Acceptance criteria:**

- [ ] Navigating between two SPA videos never offers media from the previous route.
- [ ] An advertisement manifest cannot outrank the subsequently played main video solely because its URL contains `master`.
- [ ] Two simultaneous players remain separate candidate groups.
- [ ] Video and audio from different frames are never merged.
- [ ] Tests cover reload, History API navigation, iframe playback, and ad-before-content ordering.

**Reference:** [Chrome `webRequest` request lifecycle](https://developer.chrome.com/docs/extensions/reference/api/webRequest)

### OCVD-009 — FFmpeg protocol capability negotiation

**Priority:** P0

**Outcome:** Supported FFmpeg builds receive only HTTP/reconnect flags they actually understand.

**Why:** Network arguments are currently hard-coded. FFmpeg protocol options vary by build and version, so an otherwise usable installation can fail immediately with “Option not found.”

**Scope:**

- Inspect `ffmpeg -h protocol=http` during readiness and cache supported option names.
- Build HTTP input arguments from detected capabilities instead of a fixed list.
- Preserve bounded application-level retries when newer FFmpeg retry flags are unavailable.
- Report degraded network resilience as a capability warning, not an opaque job failure.
- Establish and document the oldest FFmpeg version/build profile covered by tests.
- Keep every subprocess invocation as an argument array.

**Acceptance criteria:**

- [ ] Unsupported protocol flags are omitted automatically.
- [ ] Current FFmpeg builds use bounded retry-count and total-delay options when available.
- [ ] Older supported profiles still download using application-level retry.
- [ ] Missing essential HTTP support fails during readiness with an actionable message.
- [ ] Mocked legacy/current capability outputs and a real installed build are covered.

**Reference:** [FFmpeg HTTP and reconnect protocol options](https://ffmpeg.org/ffmpeg-protocols.html#http)

### OCVD-010 — Ambiguous media-response detection

**Priority:** P1

**Outcome:** Direct media served through XHR/fetch or generic MIME types is detected without turning arbitrary large downloads into video candidates.

**Why:** URL-based MP4/WebM detection currently requires `requestType === "media"`. Players often fetch media as `xmlhttprequest` or return `application/octet-stream`, while signed URLs may have no media extension.

**Scope:**

- Parse `Content-Disposition` filenames and retain response range metadata.
- Add confidence scoring for generic MIME types using multiple signals: filename/URL extension, `Content-Range`, large content length, media initiator, and request type.
- Recognize conventional MP4/WebM/QuickTime response aliases.
- Keep transport fragments, HTML, JSON, archives, and small binary responses excluded.
- Do not inspect or copy response bodies.
- Surface the detection reason only in sanitized diagnostics/tests, not the normal popup.

**Acceptance criteria:**

- [ ] An MP4 returned as `application/octet-stream` through XHR is detected when range/filename evidence agrees.
- [ ] An extensionless response with `Content-Disposition: ...filename="video.mp4"` is detected.
- [ ] Large ZIP, JSON, HTML, and generic API responses remain excluded.
- [ ] TS/m4s/CMAF fragments remain excluded from direct-file plans.
- [ ] Confidence thresholds are covered with positive and negative fixtures.

**Reference:** [Chrome `webRequest.onHeadersReceived`](https://developer.chrome.com/docs/extensions/reference/api/webRequest#event-onHeadersReceived)

### OCVD-011 — Default audio and language-aware selection

**Priority:** P1

**Outcome:** Multi-language HLS/DASH downloads select the intended primary audio instead of whichever track has the most channels.

**Why:** FFmpeg's automatic audio choice favors channel count. A commentary track or unrelated language can therefore outrank the manifest's default track.

**Scope:**

- Extend ffprobe metadata with stream index, disposition, language, title, and role tags.
- Select audio in this order: manifest/default disposition, browser language match, non-commentary main role, then channel count/bitrate.
- Pass `navigator.languages` as preference context without adding a normal-path setting.
- Map the chosen stream explicitly while preserving highest-resolution compatible video.
- Fall back deterministically when metadata is absent or contradictory.

**Acceptance criteria:**

- [ ] A marked default audio track wins over a higher-channel commentary track.
- [ ] When no default exists, the first browser-language match wins.
- [ ] Commentary/descriptive roles do not win unless they are the only audio available.
- [ ] Single-audio manifests behave exactly as before.
- [ ] HLS and DASH fixtures cover Portuguese/English and commentary variants.

**Reference:** [FFmpeg automatic and manual stream selection](https://ffmpeg.org/ffmpeg.html#Stream-selection)

### OCVD-012 — Local browser compatibility fixture site

**Priority:** P0

**Outcome:** Compatibility changes are reproduced end to end in Chrome without depending on third-party sites, accounts, or expiring URLs.

**Scope:**

- Serve fixtures through the project `.venv` using localhost only.
- Generate media locally with FFmpeg: direct MP4, generic-MIME XHR, redirects, split tracks, HLS VOD/live, DASH, and multi-language audio.
- Include SPA route changes, ad-before-content, two-player, iframe, and HLS Blob pages.
- Include temporary HTTP failure, expired-token, cancellation, live-stop, and popup close/reopen scenarios.
- Add a concise manual Chrome checklist and sanitized expected events.
- Keep DRM and third-party media outside the fixture suite.

**Acceptance criteria:**

- [ ] One command from the project `.venv` starts the complete fixture site.
- [ ] Fixtures are deterministic and require no internet access.
- [ ] Each planned compatibility item has at least one failing-before/passing-after scenario.
- [ ] Windows Chrome results can be recorded without capturing cookies or signed URLs.

### OCVD-013 — Explicit yt-dlp compatibility lifecycle

**Priority:** P1

**Outcome:** Site extractor breakage is diagnosable and recoverable through a reviewed, explicit update without silent dependency changes.

**Scope:**

- Report installed, pinned, and recommended yt-dlp versions in host capabilities.
- Show a concise “extractor update available” state only when the fallback is relevant.
- Add an explicit installer upgrade flag that installs the reviewed lock file into the production `.venv`.
- Add a local generic-extractor fixture to verify progress, merge, cancellation, and cookie-file cleanup.
- Document the version-review process and rollback command.
- Keep auto-update, remote components, and plugin directories disabled.

**Acceptance criteria:**

- [ ] Normal sniffed downloads never depend on yt-dlp version state.
- [ ] An outdated installation is distinguishable from an unsupported page.
- [ ] Upgrade and rollback are explicit and remain inside the production `.venv`.
- [ ] The host never downloads or executes an update on its own.
- [ ] A localhost generic-extractor fixture passes without external sites.

### OCVD-014 — Portable playback and HDR policy

**Priority:** P2 — conditional

**Activation condition:** A valid MP4 produced by stream copy fails playback in the target Windows/browser environment, or an HDR transcode produces visibly incorrect output.

**Outcome:** “Compatible MP4” means playable on the target device, not merely accepted by the MP4 muxer.

**Scope:**

- Separate container compatibility from browser/OS decoder compatibility.
- Probe codec profile/level, pixel format, color primaries, transfer function, and HDR metadata.
- Check browser decode support before copying HEVC/AV1 or other advanced streams.
- Preserve HDR when supported; otherwise use an explicit tested tone-map path or fail clearly rather than silently washing out color.
- Keep H.264/AAC as the conservative fallback and warn before unusually expensive transcodes.

**Acceptance criteria:**

- [ ] H.264/AAC remains the broad baseline.
- [ ] HEVC/AV1 is copied only when the target playback profile reports support.
- [ ] HDR fixtures preserve metadata or pass a visual/metadata tone-map check.
- [ ] Unsupported advanced codecs never produce a “complete” file that the target browser cannot decode.

### OCVD-015 — Frame-aware deep detection

**Priority:** P2 — conditional

**Activation condition:** An authorized embedded player constructs a valid HLS Blob inside a child frame and normal detection plus yt-dlp both fail.

**Outcome:** Deep detection can observe the opted-in player frame without becoming a global all-frame injector.

**Scope:**

- Associate deep candidates with sender `frameId` and `documentId`.
- Enable matching child frames only for the user-approved site/player origins.
- Feature-detect `allFrames` and `matchOriginAsFallback`; the latter requires Chrome 119+.
- Cover `about:`, `data:`, and `blob:` child frames only when their fallback origin matches an approved origin.
- Preserve the 2 MiB HLS-only limit and avoid fetch/XHR interception.

**Acceptance criteria:**

- [ ] A same-origin iframe Blob fixture is detected after opt-in.
- [ ] A cross-origin player requires explicit origin approval.
- [ ] Unrelated frames receive no main-world detector.
- [ ] Candidates remain isolated by frame/document during selection.

**Reference:** [Chrome dynamic content-script frame options](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)

### OCVD-016 — Expired signed-URL reacquisition

**Priority:** P2 — conditional

**Activation condition:** A reproducible authorized stream expires between detection and native retrieval and succeeds after the page requests a fresh URL.

**Outcome:** A single expired media token can be replaced from newly observed page traffic without credential automation or infinite authentication retries.

**Scope:**

- Classify `401`, `403`, and `410` separately from transient network failures.
- Emit a sanitized “waiting for refreshed media” state tied to the original document/frame/session.
- Accept only a newly observed candidate with the same media kind and playback group.
- Retry once with the new URL/header context; never retry the rejected URL.
- Bound the wait and preserve all URL/token redaction.

**Acceptance criteria:**

- [ ] A rotating-token localhost fixture succeeds after one fresh candidate is observed.
- [ ] No new candidate returns a concise timeout without leaving partial output.
- [ ] Authentication failures never enter the normal network retry loop.
- [ ] Candidates from another tab/frame/player cannot satisfy the refresh.

## Implemented ergonomics

### OCVD-017 — Auto-rename downloads from the page title/heading

**Priority:** P2

**Status:** Released; verified in Windows Chrome.

**Outcome:** A saved file is named after what the user sees on the page, formatted as a clean kebab-case slug (a page whose `<h1>` is "Showcase Video" saves `showcase-video.mp4`).

**Scope:**

- Add a Unicode-aware `slugify()` to `extension/media.js`, kept separate from `sanitizeFilename` so the host's OS-safe-character pass and its tests are unchanged.
- Default every download name to `slugify(document.title)` — no new permission and no page injection.
- Optional **"Use page headings for filenames"** popup toggle reads the page `<h1>` through a one-shot, on-gesture `chrome.scripting.executeScript`. It requests the already-optional `scripting` permission on demand (mirroring deep detection) and is off by default, so the extension still injects nothing into pages unless the user opts in.
- Fall back to the slugged tab title whenever the opt-in is off, scripting is not granted, or the page blocks injection (`chrome://`, PDF viewer, restricted/cross-origin).

**Acceptance criteria:**

- [x] `slugify` converts titles to kebab-case and is Unicode-aware (`tests/media.test.mjs`).
- [x] `sanitizeFilename` behavior and its existing tests are unchanged.
- [x] Manifest permissions are unchanged; `scripting` stays optional.
- [x] With the opt-in enabled, a real page whose `<h1>` differs from `<title>` saves using the heading (Windows Chrome).
- [x] A restricted page falls back to the slugged title without error (Windows Chrome).

### OCVD-018 — Concurrent local downloads

**Priority:** P1

**Status:** Released; verified in Windows Chrome.

**Outcome:** A download keeps running while the user navigates to another page/video and starts another, with live per-download feedback in the popup.

**Why:** Single-job was enforced in the extension (`startDownload`), the popup (one progress card), and the native host (`JobRegistry`). The host already isolated each job behind its own `ProcessController`/thread keyed by job id, and wake locks were already reference-counted by id, so the work was removing the explicit guards and de-singletonizing the extension's job state.

**Scope:**

- Native host: replace the single-job guard with a bounded `MAX_CONCURRENT_JOBS` cap and reserve output filenames atomically so two same-title jobs never clobber each other.
- Extension background: replace the singleton `jobState` with a `jobs` map keyed by id; route native and `chrome.downloads` events by id; persist/restore multiple jobs; mark each native job in error on host disconnect.
- Dedupe by `(tab, hashed media URL)` so a double-click cannot start the same download twice; cap concurrent downloads (default 3).
- Popup: render a live job list with per-row **Cancel/Stop and save**; keep **Download best quality** usable across tabs except when this tab's video is already downloading or the cap is reached.
- Popup: dismiss a finished card individually (per-card control) or clear them all (**Clear finished**); clearing only forgets the local job record and never deletes the saved file. Active jobs cannot be dismissed.
- Keep media URLs and request headers out of persisted job state (browser-fallback plans stay in memory only; dedupe keys hash the URL).

**Acceptance criteria:**

- [x] The native host runs multiple jobs concurrently, controls each independently, and rejects work beyond the cap (`tests/test_native_host.py`).
- [x] Concurrent same-title jobs reserve distinct output paths.
- [x] A canceled job still leaves the Downloads folder clean (existing test stays green).
- [x] Persisted job state contains no media URLs, headers, or cookies.
- [x] Two downloads started from different tabs both finish and show live progress (Windows Chrome).
- [x] Closing and reopening the popup restores the live multi-job list (Windows Chrome).
- [x] Finished cards can be dismissed individually or cleared in bulk without deleting the saved files (Windows Chrome).

## Recommended compatibility sequence

1. Build OCVD-012 fixtures for the current released behavior.
2. Implement the correctness floor: OCVD-007, OCVD-008, and OCVD-009.
3. Expand common-site coverage with OCVD-010 and OCVD-011.
4. Add OCVD-013 without changing the normal detector path.
5. Implement OCVD-014 through OCVD-016 only after their activation conditions are reproduced.

## Deferred or not planned

These ideas were present in the references but do not currently justify their complexity:

- **Custom HLS segment engine, multithreaded fragments, AES implementation, and segment-level resume.** Native FFmpeg already handles standard HLS, fMP4, encryption, and adaptive manifests. Reconsider only with a reproducible FFmpeg failure and a legal test fixture.
- **Batch downloads, playlists, queues, history databases, subscriptions, webhooks, notifications, and proxy UI.** These conflict with the one-click personal workflow.
- **REST server.** Native Messaging already provides a smaller, extension-ID-restricted local boundary.
- **Remote parser/plugin execution.** Do not download and evaluate third-party code.
- **Silent FFmpeg or yt-dlp binary updates.** Updates must be explicit and versioned.
- **External download-manager integrations.** File Centipede and Internet Download Accelerator references are product shortcuts, not reusable source.
- **Flattening partitioned cookies into a Netscape cookie file.** Chrome partition keys carry security context that the legacy file format cannot represent. Reconsider only if the extractor gains a partition-aware handoff.
- **WebSocket/WebTransport media reconstruction.** `webRequest` can observe handshakes but not individual payload messages; do not add a general traffic recorder without a narrow legal fixture.
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
- [x] A manual Windows Chrome smoke test passes before marking the item complete.
