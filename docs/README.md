---
description: >-
  A personal Manifest V3 extension that saves authorized page video as a clean
  MP4 through one explicit action. Best quality, local processing, no cloud.
---

# Introduction

**One-Click Video Downloader** is a personal Manifest V3 browser extension for
Chrome and Edge. It detects the video the active page is already playing, picks
the highest compatible source, and saves a single local MP4 through one primary
action.

It is intentionally smaller than tools like Cat Catch: resource lists, manual
parser controls, cloud features, and engine settings are replaced by one
automatic plan. You start playback, open the popup, and press **Download best
quality**.

{% hint style="warning" %}
This tool is for media you **own or are authorized to save**. DRM circumvention,
paywall bypass, and credential automation are out of scope by design. See
[Scope & boundaries](concepts/scope.md).
{% endhint %}

## What it does

* Direct **MP4** detection and browser-managed download.
* **HLS** (`.m3u8`) and **DASH** (`.mpd`) detection.
* Automatic pairing of separately delivered **video and audio**.
* **Live-stream recording** with *Stop and save*, plus finite-download cancellation.
* Bounded network **reconnects and retries** for temporary failures.
* **Codec-aware output** that copies compatible streams and transcodes only what is incompatible.
* **Concurrent downloads** (up to three) with live progress that keep running if the popup closes.
* Automatic **kebab-case filenames** from the page title, with an optional page-heading mode.
* Optional pinned **yt-dlp** page fallback and opt-in in-memory **HLS Blob** detection.
* **100% local**: no analytics, no remote parser, no cloud service.

## What it deliberately does not do

DRM bypass, paywall circumvention, credential automation, batch download queues,
cloud conversion, and site-specific extractors are all out of scope. That
restraint is the point — see [Scope & boundaries](concepts/scope.md).

## Where to start

| Page | What you'll find |
| --- | --- |
| [Requirements](getting-started/requirements.md) | Browser, Python, and FFmpeg prerequisites |
| [Installation](getting-started/installation.md) | Load the extension and install the native host |
| [Using the extension](getting-started/usage.md) | Downloading, live capture, filenames, concurrency |
| [How it works](concepts/how-it-works.md) | The detection-to-MP4 pipeline and architecture |
| [Privacy & security](concepts/privacy-and-security.md) | The local-only boundary and its guarantees |

***

Current release `0.2.0`, verified in Windows Chrome. Licensed **GPL-3.0-only**;
the request-observation approach is informed by
[Cat Catch](https://github.com/zhaoboy9692/cat-catch) (also GPL-3.0).
