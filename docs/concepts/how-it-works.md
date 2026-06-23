---
description: How the extension goes from page media to a validated local MP4.
---

# How it works

The normal experience hides manifests, fragments, stream pairing, codecs, FFmpeg
arguments, and downloader engines. Underneath, a Manifest V3 service worker
observes the page's media requests, classifies and groups candidates, selects
the best plan, and routes it.

## The pipeline

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

## Selection hierarchy

The normal path chooses the highest compatible source, in this order:

1. **Direct MP4** through the browser's own downloader.
2. **Observed HLS, DASH, or paired tracks** through the native FFmpeg host.
3. **Optional pinned yt-dlp** page fallback when no request candidate exists.
4. **Opt-in HLS Blob detection** for manifests created only in page memory.

`ffprobe` determines selected stream metadata before FFmpeg starts. Video and
audio copy/transcode decisions are independent, so an incompatible audio stream
does not force compatible H.264 video through a full re-encode. Full H.264/AAC
transcoding remains the conservative last fallback.

## The control-data boundary

Media bytes **never** pass through Native Messaging. The extension sends only
control data: HTTP(S) URLs, an allowlisted subset of request headers, job type,
job-control messages, and bounded inline HLS text when deep detection is
explicitly enabled. FFmpeg (or yt-dlp) retrieves and processes the media
directly. See [Privacy & security](privacy-and-security.md).

## Components

### Browser extension

| File | Responsibility |
| --- | --- |
| `manifest.json` | Identity, permissions, browser floor, icons |
| `background.js` | Request observation, candidate lifecycle, native connection, multi-job state |
| `media.js` | Classification, scoring, pairing, best-plan selection, filename slugging |
| `popup.{html,css,js}` | One-action UI and the live multi-job list |
| `power.js` | Reference-counted optional wake-lock leases |
| `deep-main.js` / `deep-isolated.js` | Opt-in main-world HLS Blob observation |

Normal detection uses `webRequest` and injects nothing into pages. Deep detection
is a dormant, origin-scoped fallback that requires an explicit user gesture and
the optional `scripting` permission.

### Native host

| File | Responsibility |
| --- | --- |
| `one_click_video_host.py` | Framed protocol, validation, ffprobe, command construction, jobs, retry, cancellation, optional yt-dlp, HLS text, validation |
| `install_host.py` | Copy/install/uninstall, production `.venv`, launcher, browser registration |

The host keeps its read loop responsive while worker threads own subprocesses.
Finite jobs support cancellation; live or unknown-duration work supports *Stop and
save*, which finalizes and then validates the output before promotion.
