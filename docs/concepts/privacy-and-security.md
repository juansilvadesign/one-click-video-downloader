---
description: Why your media never touches a server, and the guarantees behind it.
---

# Privacy & security

Everything runs on your machine. The extension sends only **control data** to the
local host — URLs, an allowlisted subset of request headers, and job commands —
and FFmpeg fetches and processes the media directly. The bytes stay between the
page and your disk.

```text
Page ──► Local host ──► Your disk
       (control data only; media bytes never relayed)
```

## Guarantees

* Media bytes never pass through Native Messaging.
* Only validated **HTTP(S)** remote inputs are accepted.
* Request headers are allowlisted; values containing newlines are rejected.
* URLs, cookies, authorization headers, signed tokens, and private manifests are
  redacted from logs, persisted state, and user-visible errors.
* FFmpeg, ffprobe, and yt-dlp are invoked with an argument array, never through a
  shell.
* `yt-dlp` runs through the production `.venv`, ignores user configuration,
  disables plugin directories, and never self-updates.
* In-memory manifests are limited to 2&nbsp;MiB and may resolve only HTTP(S)
  remote references.
* The host manifest allows only the registered extension ID.
* No analytics, conversion API, remote parser, or cloud processing service.

## Optional permissions

Privileged capabilities stay user-initiated and narrowly scoped. The normal path
injects nothing into pages.

| Permission | When it is used |
| --- | --- |
| `cookies` | Only if you enable cookie handoff for a page fallback; disabled by default, written to a private temporary Netscape file, deleted on every terminal path |
| `scripting` | Only for the opt-in page-heading filename mode or deep HLS detection, on an explicit gesture |
| `power` | Only for an optional, reference-counted wake lock while a native job runs |

{% hint style="success" %}
Output is written to a partial file first and **promoted only after ffprobe
validation**, so an interrupted job never leaves a broken MP4 in its place.
{% endhint %}

## Authorized use

Process only media you own or are authorized to save. DRM circumvention, paywall
bypass, and credential automation are out of scope — see
[Scope & boundaries](scope.md).
