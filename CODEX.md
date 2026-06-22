# CODEX.md — One-Click Video Downloader

Read this file first when working inside this project. It is the compact operating contract for future Codex sessions. Read `CONTEXT.md` next for the complete product and architecture brief.

## Session start

Use this order:

1. `CODEX.md`
2. `CONTEXT.md`
3. `THEORY.MD`
4. `BACKLOG.md` if the request involves planned compatibility work
5. Only the implementation and tests relevant to the requested behavior

Do not restart architectural discovery from Cat Catch unless the current local design is demonstrably insufficient. The implemented extension and its tests are the source of truth.

## Product in one paragraph

This is a personal Manifest V3 Chrome/Edge extension for saving authorized page video through one explicit action. It detects and ranks direct MP4, HLS, DASH, and split audio/video candidates. Direct MP4 uses `chrome.downloads`; adaptive, split, remux, transcode, and optional fallback work uses a local Python Native Messaging host with FFmpeg/ffprobe and optional pinned yt-dlp. Media bytes never pass through Native Messaging.

## Current release state

- Version: `0.2.0`
- Windows Chrome: extension and production native host manually verified through `0.2.0`
- Automated baseline: four JavaScript test files and 29 Python tests pass via `npm test` and the project `.venv`
- Released and verified in Windows Chrome: auto-rename to kebab-case filenames with optional page-heading naming (`BACKLOG.md` OCVD-017) and concurrent local downloads (OCVD-018)
- README showcase: generated and linked
- Next focus: compatibility fixtures and correctness items in `BACKLOG.md`
- Do not mark planned backlog acceptance criteria complete without automated evidence and the required Windows Chrome verification.

## Hard constraints

- Process only media the user owns or is authorized to save.
- DRM bypass, paywall bypass, credential automation, batch queues, and remote conversion are out of scope.
- Keep processing local; add no analytics or remote parser service.
- Preserve the one-primary-action popup.
- Preserve the direct-MP4 `chrome.downloads` fast path.
- Keep media bytes out of Native Messaging.
- Accept only validated HTTP(S) remote media inputs.
- Invoke subprocesses with argument arrays; never use a shell.
- Redact URLs, cookies, authorization headers, signed tokens, and private manifests.
- Write partial output first and promote only after ffprobe validation.
- Keep optional permissions user-initiated and narrowly scoped.
- Never silently install or update FFmpeg, yt-dlp, plugins, or executable components.

## Mandatory `.venv` rule

All project Python must run through a `.venv` in both testing and production.

Linux/WSL:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python tests/http_smoke.py
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv\Scripts\python.exe tests\http_smoke.py
```

`npm test` is preferred for the complete suite because `tests/run-python-tests.mjs` resolves the project `.venv`. Never replace these with a global `python`, `python3`, or `py` command after setup. The only allowed global invocation is the one-time command that creates `.venv`.

The installed native host uses its own production `.venv`, created and bound by `native-host/install_host.py`. A Windows Chrome host must be installed with Windows Python/FFmpeg; WSL Python and FFmpeg are not visible to Windows Chrome.

## Architecture boundaries

### Extension

- `extension/background.js` owns observation, candidates, native connection, and multi-job state (a `jobs` map keyed by id; never reintroduce a single-job singleton).
- `extension/media.js` owns pure media classification, selection rules, and filename slugging (`slugify`); keep `sanitizeFilename` as the host's separate OS-safe-character pass.
- `extension/popup.js` presents the selected plan, explicit fallbacks, and a live multi-job list; do not move durable state into the popup.
- Reading the page `<h1>` for filenames is opt-in and on-gesture; keep `scripting` optional and fall back to the tab title when it is absent or injection is blocked.
- `extension/power.js` owns reference-counted wake-lock leases.
- `extension/deep-main.js` and `deep-isolated.js` are an opt-in HLS-only fallback, not the normal detector.

Prefer pure, deterministic functions for classification, scoring, pairing, and state transitions. Candidate improvements must account for document, frame, navigation generation, and playback session; do not add another tab-wide heuristic without fixtures.

### Native host

- `native-host/one_click_video_host.py` owns the framed protocol, validation, probing, job registry, retries, process control, and optional extractor.
- Keep the Native Messaging read loop responsive while jobs run.
- Distinguish cancel from live **Stop and save**.
- Select video/audio copy or transcode independently.
- Keep reconnects, full-job retries, and authentication failures as separate policies.
- Use the installed FFmpeg's actual capabilities instead of assuming upstream flags exist.
- Keep yt-dlp pinned, configuration-independent, plugin-disabled, explicit to install, and isolated in the production `.venv`.

### Installer

- `native-host/install_host.py` copies the host, creates the production `.venv`, writes a launcher bound to it, and registers the exact extension ID.
- Registration occurs in the operating system running the browser.
- Preserve uninstall and upgrade behavior when changing installed files.

## Test commands

From the project root:

```bash
npm test
npm run test:js
npm run test:python
.venv/bin/python tests/http_smoke.py
```

Use the Windows `.venv` path for the smoke test when running directly on Windows.

Run the smallest relevant test during iteration, then `npm test` before handing off a meaningful code change. Run `tests/http_smoke.py` for HTTP, FFmpeg, HLS, merge, retry, codec, cancellation, or finalization changes.

Browser-facing changes also require a manual unpacked-extension check. This WSL environment may not have GUI Chrome, so clearly separate automated evidence from pending Windows Chrome verification.

## Definition of done

For code changes:

- Relevant regression test added or updated
- `npm test` passes
- HTTP/FFmpeg smoke passes when applicable
- No global Python used
- Direct MP4 path remains intact
- Native commands remain shell-free argument arrays
- Sensitive media context remains redacted
- Required permission and security implications documented
- README/CONTRIBUTING updated when installation or user behavior changes
- BACKLOG status changed only when its acceptance criteria are actually satisfied
- Windows Chrome verification performed or explicitly left pending

For diagnosis-only requests, inspect and explain the cause; do not implement unless requested.

## Compatibility work sequence

The preferred order is deliberate:

1. Build `OCVD-012` local browser fixtures.
2. Correct the browser floor (`OCVD-007`), candidate scope (`OCVD-008`), and FFmpeg capability negotiation (`OCVD-009`).
3. Add ambiguous response and audio-language behavior (`OCVD-010`, `OCVD-011`).
4. Add explicit yt-dlp lifecycle support (`OCVD-013`).
5. Implement conditional items only after reproducing their activation condition.

Do not solve compatibility by accumulating site-specific URL rules. Prefer local deterministic fixtures and general protocol/document behavior.

## Security review triggers

Stop and assess threat impact before changes that:

- add Chrome permissions or host access;
- inject page-world code or broaden frame coverage;
- transfer new data through Native Messaging;
- accept new input schemes or local paths;
- handle cookies or authentication context;
- add or update an executable dependency;
- change subprocess construction, output promotion, or cleanup;
- alter URL/header logging or user-visible errors.

## Reference-source rules

Repositories under `knowledge/sources/video-downloader-extension/` are research inputs only.

- Do not execute their installers, bundled binaries, databases, or plugin loaders.
- Do not copy source without checking its license and documenting provenance.
- Cat Catch-derived GPL work must retain GPL-compatible attribution and distribution obligations.
- Prefer clean implementation of a demonstrated behavior over copying code.
- Never copy secret-looking values, configs, cookies, or tokens from references.

## README showcase workflow

Editable motion source:

```text
hyperframes/readme-showcase/
```

Published assets:

```text
assets/showcase/one-click-video-downloader-showcase.mp4
assets/showcase/one-click-video-downloader-showcase-poster.png
```

Brand assets:

```text
assets/logo/brand.png
assets/logo/profile-nobg.svg
assets/logo/profile-white.svg
```

Use the Hyperframes skill for showcase edits. Keep the existing `frame.md` identity, vendored fonts/assets, deterministic seekable timeline, scene transitions, and 12-second duration unless the user asks for a structural change. Use the multicolor mark on light surfaces and the white mark on saturated blue.

Hyperframes commands use Node 22 and pinned CLI `0.6.51`:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 22
cd hyperframes/readme-showcase
npx --yes hyperframes@0.6.51 lint
npx --yes hyperframes@0.6.51 validate
npx --yes hyperframes@0.6.51 inspect --samples 15
npx --yes hyperframes@0.6.51 render --quality draft --workers 1 \
  --output "$(pwd)/../../assets/showcase/one-click-video-downloader-showcase.mp4"
```

After rendering, use ffprobe to confirm H.264, 1920×1080, 30 fps, 12 seconds, and `yuv420p`. Extract the poster from approximately 10.8 seconds. Visually inspect representative frames; automated layout checks cannot judge semantic alignment or logo contrast.

Known non-blocking tooling behavior:

- Hyperframes emits a composition-size advisory for the single-file showcase.
- Its silent composition may trigger a harmless headless `AudioContext` user-gesture warning.
- The optional animation-map helper currently fails in its temporary producer dependency because of an ESM `__dirname` issue; lint, validate, inspect, and render are the authoritative checks for this composition.

## File map

| Path | Role |
|---|---|
| `README.md` | User setup, Windows Chrome guide, usage, security |
| `CONTEXT.md` | Complete current project brief |
| `THEORY.MD` | Operating theory and architectural reasoning |
| `BACKLOG.md` | Released/planned compatibility outcomes |
| `CONTRIBUTING.md` | Contribution contract and verification expectations |
| `extension/` | Unpacked browser extension |
| `native-host/` | Python Native Messaging host and installer |
| `tests/` | JavaScript, Python, and real FFmpeg fixtures |
| `assets/` | Brand, extension icon, and README showcase assets |
| `hyperframes/` | Editable video composition source |

## Common mistakes

- Using global Python instead of `.venv`
- Treating every detected URL as a complete media file
- Sending media bytes through Native Messaging
- Moving long-lived job state into the popup
- Pairing audio and video across unrelated documents or players
- Retrying authentication failures as transient network errors
- Making optional cookie/scripting/power permissions permanent
- Logging signed URLs or captured request headers
- Replacing native FFmpeg with browser WebAssembly for large files
- Adding another downloader engine before fixing reproducible compatibility behavior
- Updating release/backlog claims without Windows browser evidence
