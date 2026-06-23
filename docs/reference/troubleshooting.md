---
description: Common issues installing and running the native host, and how to fix them.
---

# Troubleshooting

Most problems come from the browser not seeing the host or FFmpeg. After most
fixes, **fully restart the browser** — reloading only the extension is often not
enough, because the browser passes its environment to the native host at launch.

## "Specified native messaging host not found"

Confirm the extension ID, rerun the host installer for that ID, then fully restart
the browser. See [Installation](../getting-started/installation.md).

## "FFmpeg is not available on PATH"

Confirm both `ffmpeg -version` and `ffprobe -version` work in a **new** terminal,
then fully restart the browser so it inherits the updated `PATH`.

## The extension ID changed

Rerun the installer with the new ID. The host deliberately rejects every extension
origin except the registered one.

## The browser downloads the video but FFmpeg jobs fail

Keep the source page open and authenticated until processing completes. Signed
media URLs and cookies can expire mid-job.

## "Page extractor fallback" does not appear

Rerun the installer with `--with-yt-dlp`, fully restart the browser, then reopen
the popup.

## A live stream never finishes

Use **Stop and save**. The host first asks FFmpeg to finalize the MP4, then
validates it before presenting it as complete.

## Deep detection finds nothing

Enable it **before** playback, allow the page reload, then start the video again.
It intentionally observes HLS Blob manifests only, not every fetch/XHR call.

## The repository was moved

The installed host keeps working because it was copied to a user-local
application directory. Rerun the installer only when its source changes or the
extension ID changes.

{% hint style="info" %}
Still stuck? Open an issue on
[GitHub](https://github.com/juansilvadesign/one-click-video-downloader/issues)
with your OS, browser version, and the popup footer status (FFmpeg / ffprobe
versions or the host error).
{% endhint %}
