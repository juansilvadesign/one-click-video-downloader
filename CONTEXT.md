# CONTEXT.md — One-Click Video Downloader

> Self-contained project brief for a new AI or human contributor. Read this after `CODEX.md` and before changing implementation. `THEORY.MD` explains the deeper architectural reasoning; this file explains the current product and system.

## 1. What this project is

One-Click Video Downloader is a personal Manifest V3 browser extension that detects video requested by the active page, chooses the highest compatible source, and saves one local MP4 through one primary action.

- Current release: `0.2.0`
- Current browser validation: reinstalled, reloaded, and manually verified in Windows Chrome
- Current automated baseline: `npm test` passes four JavaScript test files and 26 Python tests through the project `.venv`
- Intended use: media the user owns or is authorized to save
- License: GPL-3.0-only
- Origin: informed by Cat Catch's request-observation approach, with a deliberately simpler product model

The normal experience hides manifests, fragments, stream pairing, codecs, FFmpeg arguments, and downloader engines. The user starts playback, opens the popup, and selects **Download best quality**.

This is not a DRM bypass, credential automation tool, batch downloader, cloud conversion service, or general network inspector.

## 2. Product contract

The durable product promise is:

1. Detect the best usable source for the current playback.
2. Use Chrome's native download path when a direct MP4 is already sufficient.
3. Use the local native host when adaptive media, split tracks, remuxing, or transcoding is required.
4. Save a validated MP4 in the host operating system's Downloads folder.
5. Keep the normal interaction to one explicit download action.

The implementation may grow compatibility layers, but those layers must not become engine or codec choices in the normal popup.

## 3. End-to-end architecture

```text
page media requests
       │
       ▼
Manifest V3 service worker
  webRequest observation
  response classification
  candidate grouping + selection
       │
       ├─ direct MP4 ───────────────► chrome.downloads ─► Downloads/*.mp4
       │
       ├─ HLS / DASH / split A/V ──► Native Messaging
       │                                  │
       ├─ optional yt-dlp fallback ───────┤ control data only
       │                                  │
       └─ opt-in HLS Blob detector ───────┤
                                          ▼
                                  local Python host
                                  ffprobe → codec plan
                                  FFmpeg / optional yt-dlp
                                          │
                                          ▼
                                  validated Downloads/*.mp4
```

Media bytes never pass through Native Messaging. The extension sends control data: HTTP(S) URLs, an allowlisted subset of request headers, job type, bounded inline HLS text when explicitly enabled, and job-control messages. FFmpeg or yt-dlp retrieves media directly.

## 4. Main implementation areas

### Browser extension

| File | Responsibility |
|---|---|
| `extension/manifest.json` | Manifest V3 identity, permissions, browser floor, icons |
| `extension/background.js` | Request observation, candidate lifecycle, native connection, job state |
| `extension/media.js` | Media classification, scoring, pairing, and best-plan selection |
| `extension/popup.html` | Popup structure |
| `extension/popup.css` | Popup presentation |
| `extension/popup.js` | User actions, status rendering, native capabilities, fallbacks |
| `extension/power.js` | Reference-counted optional wake-lock lease |
| `extension/deep-main.js` | Opt-in main-world HLS Blob observation |
| `extension/deep-isolated.js` | Bounded bridge from page world to extension world |

Normal detection uses `webRequest`; it does not require a content script. Deep detection is a dormant, origin-scoped fallback that requires an explicit user gesture and the optional `scripting` permission.

### Native host

| File | Responsibility |
|---|---|
| `native-host/one_click_video_host.py` | Framed Native Messaging protocol, dependency checks, ffprobe, command construction, jobs, retry, cancellation, yt-dlp, HLS text handling, validation |
| `native-host/install_host.py` | Copy/install/uninstall workflow, production `.venv`, launcher, browser registration |
| `requirements.txt` | Development/test Python dependencies; intentionally minimal |
| `requirements-yt-dlp.txt` | Explicit pinned optional extractor version |

The host keeps its read loop responsive while worker threads own subprocesses. Finite jobs support cancellation. Live or unknown-duration work supports **Stop and save**, which asks FFmpeg to finalize and then validates the output before promotion.

### Tests

| File | Coverage |
|---|---|
| `tests/media.test.mjs` | Classification, scoring, highest-quality plans, stream pairing |
| `tests/manifest.test.mjs` | Manifest and permission expectations |
| `tests/deep.test.mjs` | Opt-in HLS Blob detector and bridge constraints |
| `tests/power.test.mjs` | Wake-lock lease behavior |
| `tests/test_native_host.py` | Protocol, validation, command construction, process/job behavior |
| `tests/test_installer.py` | Installer and production `.venv` launcher |
| `tests/http_smoke.py` | Real local FFmpeg/HTTP resilience, HLS, merging, and selective codecs |
| `tests/run-python-tests.mjs` | Ensures Python tests run through the project `.venv` |

## 5. Non-negotiable invariants

### Authorized and local-only media handling

- Process only media the user owns or is authorized to save.
- DRM circumvention, paywall bypass, and credential automation stay out of scope.
- No analytics, conversion API, remote parser, or cloud processing service.
- Do not silently download or execute FFmpeg, yt-dlp components, plugins, or other binaries.

### Python environment isolation

- Every development, test, installer, and production Python process must run from a `.venv`.
- Linux/WSL development interpreter: `.venv/bin/python`.
- Windows development interpreter: `.\.venv\Scripts\python.exe`.
- The installer creates a separate production `.venv` under the installed host directory.
- Never substitute a global `python`, `python3`, or `py` invocation after the environment exists.

### Native boundary and subprocess safety

- Media bytes stay out of Native Messaging.
- Accept only validated HTTP(S) remote inputs.
- Allowlist request headers; reject newline-bearing values.
- Never expose URLs, cookies, authorization headers, signed tokens, or private manifests in logs or user-visible errors.
- Invoke FFmpeg, ffprobe, and yt-dlp with argument arrays, never through a shell.
- Write partial output first and promote only after successful validation.
- Cookie handoff is explicit, temporary, permission-scoped, private on disk, and deleted on every terminal path.

### Product behavior

- Preserve the direct-MP4 fast path through `chrome.downloads`.
- Preserve automatic highest-compatible-quality selection.
- Keep adaptive and split-track processing in the native host.
- Keep job state outside the popup so closing the popup does not cancel native work.
- Keep privileged Chrome capabilities optional unless normal detection requires them.

## 6. Current compatibility model

The normal selection hierarchy is:

1. Direct MP4 through Chrome.
2. Observed HLS, DASH, or paired tracks through native FFmpeg.
3. Optional pinned yt-dlp page fallback when no request candidate exists.
4. Opt-in HLS Blob detection for manifests created only in page memory.

ffprobe determines selected stream metadata before FFmpeg starts. Video and audio copy/transcode decisions are independent, so an incompatible audio stream does not force compatible H.264 video through a full encode. Full H.264/AAC transcoding remains the conservative last fallback.

Retry behavior is bounded. Installed FFmpeg protocol capabilities vary, so the next compatibility release must negotiate HTTP/reconnect options instead of assuming every build supports the same flags.

## 7. Current status and next work

Release `0.2.0` is working in Windows Chrome. Released capabilities include:

- Direct MP4, HLS, DASH, and split audio/video handling
- Controlled live recording and finite-job cancellation
- Native reconnects and bounded whole-job retries
- Codec-aware selective transcoding
- Optional pinned yt-dlp fallback
- Opt-in bounded HLS Blob detection
- Optional reference-counted system wake lock
- Windows production-host installation into its own `.venv`

The next work is compatibility hardening, not another downloader engine. Use `BACKLOG.md` as the authoritative scope. Recommended order:

1. `OCVD-012` — local browser compatibility fixture site
2. `OCVD-007` — honest Chrome/Edge lifecycle floor
3. `OCVD-008` — document/frame/playback-scoped candidates
4. `OCVD-009` — FFmpeg protocol capability negotiation
5. `OCVD-010` and `OCVD-011` — ambiguous responses and intended audio selection
6. `OCVD-013` — explicit yt-dlp compatibility lifecycle

Do not implement conditional items `OCVD-014` through `OCVD-016` without first reproducing their activation condition.

Known compatibility risks:

- `minimum_chrome_version` is still `102`; the planned honest floor is `106` because of Native Messaging service-worker behavior and document IDs.
- Candidate state is still primarily tab-scoped, so SPA navigation, ads, iframes, or multiple players need stronger isolation.
- FFmpeg HTTP/reconnect flags are currently based on a compatible common subset rather than runtime capability negotiation.
- Generic MIME/XHR direct media and default-language audio selection need fixtures.
- Real desktop fixtures remain desirable for yt-dlp, HLS Blob child frames, optional permission denial, and Windows process interruption.

## 8. Commands and environments

### Linux or WSL development

```bash
cd knowledge/projects/one-click-video-downloader
python3 -m venv .venv                 # first setup only
.venv/bin/python -m pip install -r requirements.txt
npm test
.venv/bin/python tests/http_smoke.py
```

After `.venv` exists, use `.venv/bin/python` directly; do not keep invoking global Python.

### Windows PowerShell development

```powershell
cd knowledge\projects\one-click-video-downloader
py -3 -m venv .venv                   # first setup only
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm test
.\.venv\Scripts\python.exe tests\http_smoke.py
```

### Manual browser verification

1. Load or reload `extension/` from `chrome://extensions`.
2. Start playback on an authorized fixture.
3. Open the extension and select **Download best quality**.
4. Verify direct MP4 uses Chrome downloads.
5. Verify adaptive/split inputs use the production native host and save a valid MP4.
6. Verify popup close/reopen, cancel, live stop, errors, and host disconnect behavior.
7. Confirm no sensitive URL/header data appears in the popup, console, or host errors.

## 9. Brand and README showcase

The README uses a clickable poster linked to a silent 12-second H.264 showcase.

| Path | Purpose |
|---|---|
| `assets/logo/brand.png` | Full brand board |
| `assets/logo/profile-nobg.svg` | Standard multicolor mark |
| `assets/logo/profile-white.svg` | All-white mark for saturated backgrounds |
| `assets/showcase/one-click-video-downloader-showcase.mp4` | Published README showcase |
| `assets/showcase/one-click-video-downloader-showcase-poster.png` | README hero/poster |
| `hyperframes/readme-showcase/` | Editable Hyperframes source and local render assets |

The composition is 1920×1080, 30 fps, 12 seconds, silent, and pinned to Hyperframes `0.6.51`. Its four beats are brand hook, automatic detection, local FFmpeg merge, and saved MP4. Use the multicolor logo on light surfaces and the white variant inside saturated blue processor states. Functional UI outlines should stay level and centered unless rotation has semantic value.

## 10. Documentation and source provenance

- `CODEX.md` — Codex operating rules and fast session start
- `CONTEXT.md` — current product and architecture brief
- `THEORY.MD` — architectural reasoning and decision history
- `README.md` — user installation, usage, and security documentation
- `BACKLOG.md` — planned and released work with acceptance criteria
- `CONTRIBUTING.md` — contribution, testing, security, and licensing rules
- `knowledge/sources/video-downloader-extension/` — reference repositories and research inputs

Reference repositories are not executable dependencies and are not a license-free copy source. Preserve GPL obligations for Cat Catch-derived work and review the license of every external reference before adapting code.

## 11. Recommended reading order

For a zero-context coding session:

1. `CODEX.md`
2. `CONTEXT.md`
3. `THEORY.MD`
4. `BACKLOG.md` for the requested item
5. The relevant implementation and tests
6. `README.md` or `CONTRIBUTING.md` when behavior, installation, release, or contributor guidance changes
