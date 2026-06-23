---
description: What you need installed before loading the extension and native host.
---

# Requirements

Direct MP4 downloads need only the extension. Adaptive media, split tracks, live
recording, and the optional page fallback use a small local host built on Python
and FFmpeg.

## Prerequisites

| Component | Version | Needed for |
| --- | --- | --- |
| Chrome or Edge (Chromium) | 102+ | The extension itself |
| Python | 3.10+ | The native host (adaptive / split / live jobs) |
| FFmpeg + ffprobe | on your `PATH` | Merging, remuxing, and transcoding |
| Node.js | 20+ | Development tests only |

Run the host on the **same operating system that runs the browser**. FFmpeg and
ffprobe must be reachable on that system's `PATH`.

{% hint style="warning" %}
If you just added FFmpeg to your `PATH`, **fully close Chrome** before
continuing. Chrome passes its environment to the native host, so an
already-running browser may keep the old `PATH`.
{% endhint %}

## The `.venv` rule

All project Python runs through a virtual environment, in both testing and
production. The only allowed global call is the one-time environment creation:

```bash
python3 -m venv .venv            # first setup only
.venv/bin/python -m pip install -r requirements.txt
```

The normal host uses only the Python standard library. `yt-dlp` is an optional,
pinned production dependency, installed into a separate production `.venv` only
when you ask for it during [installation](installation.md).
