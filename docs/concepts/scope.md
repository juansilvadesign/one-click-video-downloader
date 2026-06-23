---
description: What the project is for, and what it deliberately leaves out.
---

# Scope & boundaries

This is a focused tool for saving authorized page video as a clean MP4 through one
explicit action. Several popular capabilities are out of scope on purpose, and
that restraint is the point.

## The product contract

1. Detect the best usable source for the current playback.
2. Use the browser's native download path when a direct MP4 is already sufficient.
3. Use the local native host when adaptive media, split tracks, remuxing, or transcoding is required.
4. Save a validated MP4 in the operating system's Downloads folder.
5. Keep the normal interaction to one explicit download action.

Compatibility layers may grow, but they must not become engine or codec choices in
the normal popup.

## Out of scope by design

| Not supported | Why |
| --- | --- |
| DRM circumvention | The tool only handles media you are authorized to save |
| Paywall bypass | Same authorization boundary |
| Credential automation | No automated sign-in or account handling |
| Batch download queues | The product is one explicit action, not a crawler |
| Cloud conversion | Everything stays local; no remote processing |
| Site-specific extractors | Detection stays general, not a catalog of site rules |

{% hint style="warning" %}
Process only media you **own or are authorized to save**. If you need any of the
capabilities above, this is not the tool — and that is intentional.
{% endhint %}

## Licensing note

The project is licensed **GPL-3.0-only**. Its detector architecture is informed by
[Cat Catch](https://github.com/zhaoboy9692/cat-catch), which is also GPL-3.0.
Preserve source, attribution, modification notices, and other GPL obligations when
distributing a build.
