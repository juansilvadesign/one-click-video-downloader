---
description: Where planned work lives and what the current focus is.
---

# Backlog & roadmap

The authoritative, living roadmap is **`BACKLOG.md`** in the repository, with
acceptance criteria per item:

{% embed url="https://github.com/juansilvadesign/one-click-video-downloader/blob/main/BACKLOG.md" %}

## Current focus

Release `0.2.0` is working in Windows Chrome. The next work is **compatibility
hardening**, not another downloader engine. The project favors local
deterministic fixtures and general protocol/document behavior over accumulating
site-specific URL rules.

Recommended order (see `BACKLOG.md` for the canonical list and IDs):

1. Local browser compatibility fixture site.
2. Honest Chrome/Edge lifecycle floor.
3. Document / frame / playback-scoped candidates.
4. FFmpeg protocol capability negotiation.
5. Ambiguous responses and intended audio selection.
6. Explicit yt-dlp compatibility lifecycle.

## Known compatibility risks

* `minimum_chrome_version` is still `102`; the planned honest floor is `106`
  because of Native Messaging service-worker behavior and document IDs.
* Candidate state is still primarily tab-scoped, so SPA navigation, ads, iframes,
  or multiple players need stronger isolation.
* FFmpeg HTTP/reconnect flags are based on a common subset rather than runtime
  capability negotiation.
* Generic MIME/XHR direct media and default-language audio selection need
  fixtures.

{% hint style="info" %}
Treat this page as orientation. Always confirm scope and status against
`BACKLOG.md` in the repo before starting work — it is the source of truth.
{% endhint %}
