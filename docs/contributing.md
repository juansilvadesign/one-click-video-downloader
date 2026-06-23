---
description: Tests, security review triggers, and licensing for contributors.
---

# Contributing

The full contributor guide — setup, testing, security, and licensing rules —
lives in **`CONTRIBUTING.md`** in the repository:

{% embed url="https://github.com/juansilvadesign/one-click-video-downloader/blob/main/CONTRIBUTING.md" %}

This page is a quick orientation.

## Tests

All project Python runs through a `.venv` (see [Requirements](getting-started/requirements.md)).

```bash
npm test            # JavaScript tests + Python suite via the project .venv
npm run test:js     # JavaScript only
npm run test:python # Python only
.venv/bin/python tests/http_smoke.py   # real FFmpeg / HTTP / HLS / merge / codec
```

Run the smallest relevant test while iterating, then `npm test` before handing off
a meaningful change. Browser-facing changes also need a manual unpacked-extension
check on a desktop browser.

## Definition of done

* A regression test is added or updated and `npm test` passes; the HTTP/FFmpeg
  smoke test passes when applicable.
* No global Python is used; the direct-MP4 path stays intact; native commands stay
  shell-free argument arrays; sensitive media context stays redacted.
* Permission and security implications are documented; README/CONTRIBUTING are
  updated when installation or user behavior changes.
* `BACKLOG.md` status changes only when its acceptance criteria are met, including
  the required Windows Chrome verification.

## Security review triggers

Stop and assess threat impact before changes that:

* add browser permissions or host access;
* inject page-world code or broaden frame coverage;
* transfer new data through Native Messaging;
* accept new input schemes or local paths;
* handle cookies or authentication context;
* add or update an executable dependency;
* change subprocess construction, output promotion, or cleanup;
* alter URL/header logging or user-visible errors.

See [Privacy & security](concepts/privacy-and-security.md) for the invariants
these protect.

## Licensing

The project is **GPL-3.0-only**, and its detector architecture is informed by
[Cat Catch](https://github.com/zhaoboy9692/cat-catch) (also GPL-3.0). Preserve
source, attribution, modification notices, and other GPL obligations when
distributing a build, and review the license of every external reference before
adapting code.
