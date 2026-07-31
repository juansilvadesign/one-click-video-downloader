---
description: Downloading video, live capture, filenames, and running several at once.
---

# Using the extension

## Download a video

1. Open a page containing a video you are authorized to save.
2. Start playback so the page requests its media.
3. Open the extension popup.
4. Press **Download best quality**.
5. Keep the source tab open while authenticated media is processed.

Direct MP4 files use the browser's download manager. Adaptive, split, and
page-fallback jobs continue through the local native host even if the popup
closes; reopening it restores the current job state.

## Finite jobs vs. live streams

* **Cancel download** appears for finite work (a known duration).
* **Stop and save** appears for live or unknown-duration recordings. The host
  asks FFmpeg to finalize the MP4, then validates it before presenting it as
  complete.

## Filenames

Files are named after the page title as a kebab-case slug, for example
`showcase-video.mp4`.

Enable **Use page headings for filenames** in the popup to name files from the
page's on-screen `<h1>` instead. This asks for the optional `scripting`
permission and falls back to the title where it cannot read the heading.

## Several downloads at once

You can run up to three downloads concurrently. Start one, switch to another tab
or video, and start another; each shows its own live progress, and downloads
keep running in the background if you close the popup.

Finished downloads stay listed so you can confirm them:

* Dismiss a single card with its **×**.
* Use **Clear finished** to remove them all at once.

Clearing only tidies the popup list — it never deletes the saved files.

## Explicit fallbacks

If nothing is detected, the popup offers two opt-in fallbacks:

* **Page extractor fallback** appears when `yt-dlp` was installed. Browser
  cookies stay off unless you select the cookie option and approve the browser's
  permission prompt.
* **Enable deep detection for this site** grants an optional, origin-scoped
  capability, reloads the page, and observes only HLS-typed Blob manifests up to
  2&nbsp;MiB.

An optional power prompt may appear before a native job. Denying it does not
block the download; it only lets the system sleep normally.

## Record tab audio

Some players bind media delivery to the browser session rather than to request
headers. An out-of-process downloader is then a different client and receives a
decoy stream, even when the URL and headers are copied correctly. **Record tab
audio** covers that case by saving what your authorized session already decodes.

1. Start playback in the tab.
2. Open the popup, select **Record tab audio**, and approve the one-time
   `tabCapture` prompt.
3. Let the tab play. It can sit in the background, and you still hear it.
4. Select **Stop and save audio**.

The result is a WebM/Opus file in your Downloads directory, named from the page
title.

{% hint style="info" %}
Recording runs in real time — there is no way to record faster than the media
plays. Only one tab is recorded at a time, and closing the tab ends the
recording without saving. This path is audio only, because its purpose is
feeding transcription. Requires Chrome 109+ for the offscreen document.
{% endhint %}
