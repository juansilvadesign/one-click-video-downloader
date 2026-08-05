# Tasks

The living implementation checklist. Strategy, release boundaries, capacity, and
cut lines live in [`ROADMAP.md`](ROADMAP.md); item rationale and durable acceptance
criteria live in [`BACKLOG.md`](BACKLOG.md).

_Last reviewed: 2026-08-05_

> Milestones **A–C** are shipped. **D is the only execution-ready milestone.**
> E and F are deliberately coarse and must be re-planned after the preceding
> retrospective.

---

## Next — Milestone D: correct-playback compatibility baseline ▶

**Capacity ceiling:** 18 maintainer-days.

**Exit outcome:** a supported browser keeps a long local job connected, restores
its popup state, and selects/merges only media from the intended current playback
group; the native host uses only HTTP options supported by the installed FFmpeg.

### 0. Lock the frame and baseline evidence

- [x] Audit commit `a559a36` and run `npm test` on 2026-08-05: four JavaScript
      suites and 29 Python tests pass.
- [ ] Record the implementation branch/start commit and preserve unrelated user
      work if the tree is not clean.
- [ ] Record the D test matrix: operating systems, exact Chrome/Edge versions,
      unpacked-extension profiles, Python versions, FFmpeg/ffprobe builds, and
      optional yt-dlp state. Use fresh profiles with synthetic/local fixture data.
- [ ] Reconfirm the browser lifecycle and request/document APIs against current
      official Chrome/Edge documentation before locking the minimum version; save
      links and the decision in release evidence.
- [ ] Reconcile existing documentation drift before release, including the
      `CONTEXT.md` claim of 26 Python tests versus the current 29-test suite.
- [ ] Create a sanitized D evidence record containing commands, versions, expected
      fixture names, results, and screenshots. Never capture request URLs, headers,
      cookies, private titles, manifest bodies, or local account paths.
- [ ] Keep D within 18 maintainer-days and the full frame within the 2026-09-16
      deadline; invoke the protected cut line instead of extending either.

### 1. Build the localhost browser compatibility harness

- [ ] Add one project-`.venv` command that generates/serves the fixture site on
      localhost and prints only a safe local URL plus shutdown guidance.
- [ ] Generate small deterministic, maintainer-owned media with FFmpeg. Keep
      generated runtime output out of git unless a tiny committed artifact has a
      documented reason and license/provenance.
- [ ] Cover the currently shipped paths: direct MP4, split video/audio, HLS VOD,
      live/unknown-duration HLS, DASH, redirect, cancellation, live stop/finalize,
      temporary HTTP failure, and browser-download-to-native fallback.
- [ ] Add D selection pages for full reload, History API/SPA route changes,
      ad-before-content, two players in one document, same-origin iframe,
      cross-origin localhost iframe, and video/audio requests in different frames.
- [ ] Add a native job lasting beyond 30 seconds with stable progress so popup
      close/reopen and service-worker lifecycle behavior are observable.
- [ ] Add deterministic server controls for delay, disconnect, status, redirect,
      and request counting. Do not add internet access, accounts, DRM, third-party
      pages, or expiring external URLs.
- [ ] Add mock FFmpeg protocol-help outputs for the oldest supported profile and a
      current richer profile; keep real-build probing as a separate smoke lane.
- [ ] Give every compatibility claim a failing-before/passing-after fixture and a
      concise expected result; do not use third-party site success as acceptance.
- [ ] Add an operator checklist for Chrome and Edge that covers install/reload,
      popup close/reopen, state restoration, selected title/source group, output
      validation, cancellation, live stop, and sanitized failure states.
- [ ] Ensure fixture logs and browser-visible diagnostics use opaque fixture IDs,
      never full media URLs or copied authentication context.

### 2. Declare and prove the honest browser lifecycle floor

- [ ] Choose the minimum Chrome version from the lifecycle plus document-ID APIs
      D actually uses; document the corresponding supported Edge floor and why.
- [ ] Raise `minimum_chrome_version` from `102` to the chosen floor and add a
      manifest regression test that rejects any lower value.
- [ ] Align `README.md`, `docs/getting-started/requirements.md`, install guidance,
      troubleshooting, landing-page compatibility copy, `CODEX.md`, `CONTEXT.md`,
      and release notes with the same floor.
- [ ] Use `chrome.storage.session` for candidate/session state on the supported
      floor; remove any fallback that could place signed URLs or copied headers in
      durable `storage.local`.
- [ ] Bound candidate/session retention by tab, document/navigation generation,
      and age; clear it on tab removal, top-level transition, and terminal paths
      without deleting active job state.
- [ ] Prove a native job longer than the normal worker idle window remains
      connected through `runtime.connectNative()` without alarms, polling, or
      timer-based keepalive traffic.
- [ ] Close the popup during that job, wait beyond the idle window, reopen it, and
      verify the same job ID, progress/state, cancel/stop control, and final output.
- [ ] Verify startup/reload/host-disconnect behavior remains truthful: no orphaned
      wake lock, false completion, duplicate retry, or stale “running” card.
- [ ] Record supported Chrome and Edge desktop evidence. Do not mark D shipped if
      a browser named in user-facing compatibility copy is untested or failing.

### 3. Scope candidates to the current document and playback group

- [ ] Define the candidate identity before editing selection code: tab,
      `documentId`, `frameId`, top-level document/navigation generation, initiator,
      request ID, detected time, and a deterministic playback-group key/fallback.
- [ ] Extract pure grouping, retirement, pairing, and group-ranking functions into
      the testable media/state layer; keep Chrome event adapters thin.
- [ ] Capture document/frame/navigation metadata from every observable request and
      preserve an explicit fallback only for API events where an identifier is
      genuinely unavailable.
- [ ] Treat every top-level URL/document transition—including History API changes—as
      a new generation. Retire old candidates even when no `status: loading` event
      accompanies the URL change.
- [ ] Associate inline HLS candidates with the sender's document and frame. Do not
      reuse a tab's last request headers across a different document/frame/group.
- [ ] Keep captured request headers correlated by request ID and candidate group;
      expire orphaned entries and forward only the existing allowlisted minimum.
- [ ] Never pair separate video and audio across document, frame, navigation
      generation, or playback-group boundaries, even when timestamps are close.
- [ ] Replace “URL contains `master`” as an overriding global preference with
      group-local manifest/quality/recency evidence so an old ad cannot outrank the
      subsequently active compatible group.
- [ ] Define deterministic behavior for two players in the same document. Prefer
      the most recently active compatible group without exposing an engine/resource
      chooser in the normal popup.
- [ ] Include group identity—not raw URL—in duplicate-job prevention so two
      distinct players cannot suppress one another and a double-click still cannot
      start the same job twice.
- [ ] Persist only the minimum session state required for worker recovery, with a
      schema version and age bound. Keep popup/job projections free of media URLs,
      headers, cookies, and inline manifests.
- [ ] Add positive and negative unit fixtures for reload, SPA A→B→back navigation,
      ad-before-content, two simultaneous players, same/cross-origin iframe,
      missing document ID, duplicate URLs in different groups, and split tracks
      across group boundaries.
- [ ] Prove each browser fixture chooses the expected opaque fixture group and
      never starts a request for media belonging to a retired/unrelated group.

### 4. Negotiate FFmpeg HTTP protocol capabilities

- [ ] Define the essential versus optional HTTP/reconnect options and the oldest
      supported FFmpeg profile from evidence, not from an untested version claim.
- [ ] Probe `ffmpeg -hide_banner -h protocol=http` during dependency readiness with
      a bounded timeout and parse supported option names in a pure tested function.
- [ ] Cache the probe result for the host lifetime and expose only safe capability
      booleans/warnings to the extension; never expose executable paths or command
      output containing local/private context.
- [ ] Build input arguments by intersecting desired behavior with supported
      options. Preserve finite/live differences, especially no reconnect-at-EOF
      loop for finite VOD.
- [ ] Retain bounded application-level retries when optional protocol retry flags
      are absent; keep authentication, malformed input, and permanent failures out
      of the transient retry class.
- [ ] Fail readiness with an actionable sanitized message when essential HTTP(S)
      input support is missing. Treat reduced optional reconnect support as a
      capability warning rather than an opaque job failure.
- [ ] Add mocked legacy/current/malformed/timeout protocol-help tests and assert the
      exact shell-free argument arrays for finite, live, manifest-text, and split
      input plans.
- [ ] Run the existing localhost HTTP/FFmpeg smoke suite against the installed real
      build and record its version/profile plus the selected option set.
- [ ] Confirm probing and command construction never incorporate a media URL,
      copied header, cookie, page title, or inline manifest into logs/errors.

### 5. Preserve security, output, and product invariants

- [ ] Regression-test that navigation/group retirement removes candidate URLs and
      headers without canceling already-started jobs whose control state is safe.
- [ ] Search storage snapshots, popup projections, console/native logs, fixture
      logs, exceptions, screenshots, and evidence for synthetic secret markers;
      fail tests if any marker reaches a forbidden surface.
- [ ] Verify redirect/input validation still accepts only HTTP(S), rejects header
      newlines, and does not broaden allowed headers or origins as a shortcut for
      fixture success.
- [ ] Keep direct finished MP4 on `chrome.downloads`; ensure D does not route every
      download through FFmpeg.
- [ ] Preserve unique sanitized filenames, private temporary files, `.part.mp4`
      output, ffprobe validation, atomic promotion, cancellation cleanup, and live
      graceful-finalization behavior.
- [ ] Preserve the three-job cap, per-job controls, reference-counted wake lock,
      optional-permission denial behavior, and popup-safe completed-job history.
- [ ] Add no permanent permission, all-frame injection, new URL scheme, local-file
      input, remote code, silent dependency update, or site-specific extractor rule.
- [ ] Confirm GPL-3.0/Cat Catch provenance obligations remain accurate for any
      adapted detector behavior or fixtures.

### 6. Run D's automated and desktop acceptance matrix

- [ ] Run the smallest relevant suites while iterating, then `npm test` from a
      clean project environment.
- [ ] Run `.venv/bin/python tests/http_smoke.py` (or the Windows `.venv` equivalent)
      for real HTTP, retry, HLS, merge, codec, cancel, and finalization evidence.
- [ ] Install the production host into a fresh supported profile and verify its
      copied `.venv`, extension-ID restriction, readiness capability response,
      upgrade/reinstall path, and uninstall cleanup.
- [ ] Run every D browser fixture in the supported Chrome/Edge matrix and record
      exact versions plus pass/fail without request URLs or private data.
- [ ] Inspect the resulting MP4s with ffprobe and expected fixture duration/stream
      metadata; a completed UI state without a validated intended output is a fail.
- [ ] Exercise popup close/reopen, tab close, navigation during active work, host
      disconnect, extension reload, browser restart recovery, permission denial,
      cancel, live stop, and three concurrent independent jobs.
- [ ] Confirm old-route, advertisement, other-frame, and second-player media is
      never requested or merged in each negative fixture.
- [ ] Use the two-day global reserve only if a retrospective records the concrete
      compatibility/release surprise and the later scope cut that protects the
      deadline.

### 7. Accept and release D

- [ ] Update `README.md`, `CONTRIBUTING.md`, GitBook pages, landing-page config,
      `CODEX.md`, `CONTEXT.md`, and `THEORY.MD` for the measured floor, grouping
      policy, FFmpeg capability behavior, fixture command, and limitations.
- [ ] Update OCVD-007/008/009/012 in `BACKLOG.md` only after every applicable
      automated and required desktop acceptance criterion has evidence.
- [ ] Keep privacy/authorized-use language prominent and document that fixtures
      are local, synthetic/maintainer-owned, and not proof of third-party-site
      permission or universal compatibility.
- [ ] Bump the extension/package version only after manifest, docs, native protocol,
      installer, and release evidence agree.
- [ ] Record the release commit/tag, exact test commands, browser/native matrix,
      remaining capacity, known failures, and cut items in `ROADMAP.md`.
- [ ] Run the D retrospective, decide whether its risky assumption was retired,
      and rewrite E as the only detailed next milestone inside remaining capacity.

---

## Later — Milestone E: broader common-media correctness ⬜

Do not expand these items until D proves document/playback scoping and the fixture
harness.

- [ ] Add confidence-scored detection for generic MIME/XHR direct media using
      corroborating response metadata; keep archives, APIs, HTML/JSON, and media
      fragments excluded without inspecting bodies.
- [ ] Parse content disposition/range/length safely and expose only sanitized
      detection reasons in tests/diagnostics.
- [ ] Extend ffprobe metadata with stream index, disposition, language, title, and
      role; select default, browser-language, non-commentary main audio before
      channel-count/bitrate fallbacks.
- [ ] Map the chosen audio explicitly while preserving highest compatible video
      and unchanged single-audio behavior.
- [ ] Pass positive/negative generic-response fixtures and Portuguese/English/
      commentary HLS/DASH fixtures through the complete browser/native path.

## Later — Milestone F: explicit extractor maintenance ⬜

- [ ] Report installed, pinned, and reviewed/recommended yt-dlp versions without
      affecting normal sniffed downloads.
- [ ] Distinguish version mismatch from unsupported-page and ordinary auth/network
      failures with concise sanitized states.
- [ ] Add explicit installer upgrade and rollback commands confined to the
      production `.venv`; keep auto-update, user config, remote components, and
      plugin directories disabled.
- [ ] Pass a localhost generic-extractor fixture for progress, merge, cancel,
      cookie-file permissions/cleanup, version mismatch, upgrade, and rollback.
- [ ] Record dependency provenance/review evidence and update install/troubleshooting
      docs before release.

## Completed — Milestone C: usable multi-job release ✅

- [x] Name downloads from a Unicode-aware kebab-case page title.
- [x] Offer optional, on-gesture `<h1>` naming while keeping `scripting` optional.
- [x] Run up to three independent jobs with per-job progress and control.
- [x] Reserve same-title output paths without clobbering and prevent duplicate
      double-click jobs.
- [x] Restore the live job list when the popup reopens and allow finished cards to
      be dismissed without deleting saved files.
- [x] Verify OCVD-017/018 in Windows Chrome and keep automated coverage green.

## Completed — Milestone B: resilient native processing ✅

- [x] Keep the native read loop responsive while worker-owned jobs run.
- [x] Distinguish finite cancel from live **Stop and save** and validate output
      before promotion.
- [x] Add bounded reconnect/full-job retry behavior with sanitized progress.
- [x] Select video/audio copy or transcode independently with H.264/AAC fallback.
- [x] Add optional pinned yt-dlp, opt-in bounded HLS Blob detection, and optional
      reference-counted system wake lock.
- [x] Cover native process control, retries, codecs, temporary files, installer,
      deep detection, and wake-lock behavior with automated tests.

## Completed — Milestone A: one-click local core ✅

- [x] Observe and classify authorized direct MP4, HLS, DASH, and separate
      audio/video requests.
- [x] Choose one highest-compatible plan without exposing a resource list.
- [x] Keep direct MP4 in `chrome.downloads` and send adaptive/split work to a local
      Native Messaging host.
- [x] Install a production `.venv` host restricted to the selected extension ID.
- [x] Validate HTTP(S) inputs, allowlist copied headers, invoke subprocesses without
      a shell, sanitize unique filenames, and save under Downloads.

## Parked — not committed in the current frame

- OCVD-014 portable playback/HDR work without a reproduced playback/color failure.
- OCVD-015 broader frame-aware deep injection without a reproduced authorized
  child-frame Blob failure.
- OCVD-016 signed-URL reacquisition without a reproduced rotating-token fixture.
- Media the user cannot already access or is not authorized to save; DRM, paywall,
  access-control, or credential circumvention.
- Browser-profile credential extraction, background cookie harvesting, hosted
  proxying, remote parsing/plugins, cloud processing/storage, analytics, accounts,
  or retained history.
- Batch crawling, playlists, unbounded queues/concurrency, external download
  managers, public APIs, or site-specific extractor catalogs.
- Custom segment engines, WebSocket/WebTransport reconstruction, silent binary
  updates, video editing/compression controls, and media-library features.
