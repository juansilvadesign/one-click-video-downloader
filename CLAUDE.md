# CLAUDE.md — One-Click Video Downloader

Operating contract for Claude Code sessions in this project. It mirrors [`CODEX.md`](CODEX.md); both are the compact rules an AI coding agent must follow here, and they are kept in sync — when you change one, change the other. Read [`CONTEXT.md`](CONTEXT.md) for the full product and architecture brief, [`THEORY.MD`](THEORY.MD) for the reasoning, and [`BACKLOG.md`](BACKLOG.md) for planned work.

## Session start

Read in this order:

1. `CLAUDE.md` (this file) or `CODEX.md` — the operating contract.
2. `CONTEXT.md` — current product and architecture.
3. `THEORY.MD` — architectural reasoning and decision history.
4. `BACKLOG.md` — when the request involves planned compatibility work.
5. Only the implementation and tests relevant to the requested behavior.

The implemented extension and its tests are the source of truth. Do not restart architectural discovery from the Cat Catch references under `knowledge/sources/video-downloader-extension/` unless the current design is demonstrably insufficient.

## Product in one paragraph

A personal Manifest V3 Chrome/Edge extension for saving authorized page video through one explicit action. It detects and ranks direct MP4, HLS, DASH, and split audio/video candidates. Direct MP4 uses `chrome.downloads`; adaptive, split, remux, transcode, and optional page-fallback work uses a local Python Native Messaging host with FFmpeg/ffprobe and optional pinned yt-dlp. Media bytes never pass through Native Messaging.

## Hard constraints (never violate)

- Process only media the user owns or is authorized to save. DRM/paywall bypass, credential automation, batch queues, and remote conversion stay out of scope.
- Keep all processing local; add no analytics or remote parser/service.
- Preserve the one-primary-action popup and the direct-MP4 `chrome.downloads` fast path.
- Keep media bytes out of Native Messaging; accept only validated HTTP(S) remote inputs.
- Invoke FFmpeg, ffprobe, and yt-dlp with argument arrays, never through a shell.
- Redact URLs, cookies, authorization headers, signed tokens, and private manifests in logs, **persisted state**, and user-visible errors.
- Write partial output first; promote only after ffprobe validation.
- Keep optional permissions (`cookies`, `power`, `scripting`) user-initiated and narrowly scoped. The normal path injects nothing into pages; reading the page `<h1>` for filenames is opt-in, on a user gesture, and falls back to the tab title when scripting is absent or injection is blocked.
- Never silently install or update FFmpeg, yt-dlp, plugins, or executable components.

## Mandatory `.venv` rule

All project Python runs through a `.venv`, in both testing and production. The only allowed global invocation is the one-time `python -m venv .venv`.

Linux/WSL:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python tests/http_smoke.py
```

`npm test` is preferred for the full suite because `tests/run-python-tests.mjs` resolves the project `.venv`. The installed host uses its own production `.venv` created and bound by `native-host/install_host.py`. A Windows Chrome host must be installed with Windows Python/FFmpeg; WSL Python and FFmpeg are invisible to Windows Chrome.

## Architecture boundaries

### Extension

- `background.js` — observation, candidates, native connection, and **multi-job state** (a `jobs` map keyed by id; never reintroduce a single-job singleton). Owns the opt-in `<h1>` read and keeps browser-fallback plans (URLs/headers) in memory only.
- `media.js` — pure media classification, scoring, pairing, best-plan selection, and `slugify` filename formatting. Keep `sanitizeFilename` as the host's separate OS-safe-character pass; do not fold the two together.
- `popup.js` — the selected plan, explicit fallbacks, and the live multi-job list; do not move durable state into the popup.
- `power.js` — reference-counted wake-lock leases, already keyed by job id (supports overlapping jobs).
- `deep-main.js` / `deep-isolated.js` — opt-in HLS-only fallback, not the normal detector.

Prefer pure, deterministic functions for classification, scoring, pairing, slugging, and state transitions. Candidate improvements must account for document, frame, navigation generation, and playback session; do not add another tab-wide heuristic without fixtures.

### Native host

- `one_click_video_host.py` — framed protocol, validation, probing, job registry, retries, process control, and optional extractor. Keep the read loop responsive while jobs run; cap concurrency at `MAX_CONCURRENT_JOBS`; reserve output filenames atomically so concurrent same-title jobs never clobber each other. Distinguish cancel from live **Stop and save**; select video/audio copy or transcode independently; keep reconnects, full-job retries, and authentication failures as separate policies.
- `install_host.py` — copies the host, creates the production `.venv`, writes a launcher bound to it, and registers the exact extension ID. Preserve uninstall and upgrade behavior.

## Companion surfaces (not the extension runtime)

Two auxiliary surfaces live in the repo alongside `extension/` and `native-host/`. Neither is loaded by the browser or the host. Do not let work on them touch the extension, the host, or the test suite, and do not pull their tooling into the extension build.

- `astro/` — the marketing landing page. A self-contained Astro static site (pure `.astro` + scoped CSS, no React/Tailwind). Build with `npm install && npm run build` inside `astro/`; all copy and links live in `astro/src/config/site.config.ts`.
- `docs/` + `.gitbook.yaml` — the GitBook documentation site, published via Git Sync (`root: ./docs/`, `README.md` home, `SUMMARY.md` nav). Pages are authored from `README.md`/`CONTEXT.md`/`THEORY.MD`; `reference/backlog.md` and `contributing.md` embed the canonical repo files. Keep them current when install steps or user-facing behavior change.

## Test commands

```bash
npm test
npm run test:js
npm run test:python
.venv/bin/python tests/http_smoke.py
```

Run the smallest relevant test while iterating, then `npm test` before handing off a meaningful change. Run `tests/http_smoke.py` for HTTP, FFmpeg, HLS, merge, retry, codec, cancellation, or finalization changes. Browser-facing changes also require a manual unpacked-extension check; this WSL environment may have no GUI Chrome, so clearly separate automated evidence from pending Windows Chrome verification.

## Definition of done

- Relevant regression test added or updated; `npm test` passes; HTTP/FFmpeg smoke passes when applicable.
- No global Python used; direct-MP4 path intact; native commands remain shell-free argument arrays; sensitive media context stays redacted (including persisted state).
- Permission and security implications documented; README/CONTRIBUTING (and the GitBook `docs/`) updated when installation or user behavior changes.
- `BACKLOG.md` status changed only when its acceptance criteria are actually satisfied, including the required Windows Chrome verification.

For diagnosis-only requests, inspect and explain the cause; do not implement unless requested.

## Security review triggers

Stop and assess threat impact before changes that add Chrome permissions or host access; inject page-world code or broaden frame coverage; transfer new data through Native Messaging; accept new input schemes or local paths; handle cookies or authentication context; add or update an executable dependency; change subprocess construction, output promotion, or cleanup; or alter URL/header logging or user-visible errors.

## Current release state

- Version `0.2.0`; extension and production native host verified in Windows Chrome.
- Released capabilities: the `0.2.0` baseline (direct MP4, HLS/DASH/split tracks, live recording with Stop-and-save, resilient native jobs, codec-aware selective transcoding, optional pinned yt-dlp fallback, opt-in HLS Blob detection, optional wake lock) plus auto-rename to kebab-case filenames with optional page-heading naming (`BACKLOG.md` OCVD-017) and concurrent local downloads (OCVD-018), both verified in Windows Chrome.
- Automated baseline: four JavaScript test files and 29 Python tests pass via `npm test` and the project `.venv`.
- Next focus: compatibility fixtures and correctness items in `BACKLOG.md`. Do not solve compatibility by accumulating site-specific URL rules; prefer local deterministic fixtures and general protocol/document behavior.

## Common mistakes

- Using global Python instead of `.venv`.
- Treating every detected URL as a complete media file.
- Sending media bytes through Native Messaging, or persisting media URLs/headers/cookies in job state.
- Moving long-lived job state into the popup, or reintroducing a single-job singleton in `background.js`.
- Pairing audio and video across unrelated documents or players.
- Retrying authentication failures as transient network errors.
- Making optional cookie/scripting/power permissions permanent, or injecting into pages on the normal path.
- Logging signed URLs or captured request headers.
- Changing `sanitizeFilename` to do slugging (use `slugify`; keep them separate).
- Updating release/backlog claims without Windows Chrome evidence.
