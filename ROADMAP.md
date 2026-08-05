# Roadmap

The release plan for turning the working `0.2.0` extension into a reproducible,
compatibility-hardened one-click downloader for media the user owns or is
authorized to save.

**North-star outcome:** from a supported Chrome or Edge installation, one explicit
action selects the current playback—not an old route, advertisement, unrelated
frame, or second player—and produces a validated local MP4 through the browser or
the installed native host.

[`BACKLOG.md`](BACKLOG.md) remains the source of truth for item-level rationale and
acceptance criteria. This file fixes release order, capacity, and cut lines. The
execution-ready checklist lives in [`TASKS.md`](TASKS.md).

---

## Fixed frame

This frame is an inferred planning constraint because no deadline or staffing was
provided. It can be replaced by an explicit owner decision, but it must not drift
silently.

| Constraint | Commitment |
| --- | --- |
| Planning start | **2026-08-05** |
| Deadline | **2026-09-16** — six calendar weeks |
| Capacity | **30 maintainer-days** |
| Team assumption | One maintainer; browser verification may use a second machine/profile |
| Committed scope | 28 days across D–F |
| Protected reserve | 2 days for compatibility/release surprises |
| Fixed variables | Deadline, capacity, authorized-use and local-only boundaries |
| Flexible variable | Scope below each milestone's protected cut line |

If work starts late or a release consumes more capacity, reduce later scope. Do
not move the deadline, borrow the reserve casually, or mark unverified browser
behavior complete.

## Product guardrails

- Process only media the user owns or is authorized to save.
- Keep media processing local; add no analytics, remote parser, or cloud conversion.
- Preserve the one-primary-action popup and direct-MP4 `chrome.downloads` fast path.
- Keep media bytes out of Native Messaging. Accept only validated HTTP(S) inputs.
- Never log or persist beyond the bounded job/session lifetime any cookie,
  authorization header, signed URL, private manifest, or private title.
- Keep cookie, scripting, and power capabilities optional and user-initiated.
- Invoke FFmpeg, ffprobe, and optional yt-dlp with argument arrays, never a shell.
- Promote partial output only after validation; keep cancel and live **Stop and
  save** behavior truthful.
- No DRM or paywall circumvention, credential automation, site-rule catalog,
  batch crawler, remote plugins, or silent executable updates.

## Audited baseline

Audited on **2026-08-05** at commit `a559a36`.

| Area | Current evidence | Remaining risk |
| --- | --- | --- |
| Released product | `0.2.0`, manually verified in Windows Chrome | Desktop behavior is not yet reproducible from local fixtures |
| Detection | Direct MP4, HLS, DASH, split tracks, optional page fallback, opt-in inline HLS | Candidates are primarily tab-scoped |
| Native jobs | Progress, bounded retries, cancel, live stop/finalize, selective transcode | HTTP/reconnect flags are static across FFmpeg builds |
| User workflow | Kebab-case naming, optional heading naming, up to three concurrent jobs | Correctness across SPA routes, ads, frames, and two players is not proven |
| Browser floor | Manifest declares Chrome `102` | Planned lifecycle/document behavior requires an honest higher floor |
| Automated suite | `npm test`: 4 JavaScript suites and 29 Python tests pass | No local end-to-end browser fixture site |
| Real-media smoke | Local HTTP/FFmpeg smoke test exists | It does not exercise extension/browser lifecycle |
| Common compatibility | Conservative MIME classifier and FFmpeg default audio selection | Generic XHR media and intended-language/default audio remain open |
| Extractor lifecycle | yt-dlp is optional, pinned, plugin-disabled, and explicitly installed | Real/local extractor compatibility and upgrade/rollback evidence are incomplete |
| Security posture | Allowlisted headers, shell-free subprocesses, private temporary files, no analytics | Candidate/session retention and cross-document header association need regression proof |

The strategic constraint is correctness, not another downloader engine. A broader
format list is not valuable if the extension can choose the wrong playback or an
installed FFmpeg rejects hard-coded options.

## Release sequence

`✅ shipped` · `▶ next` · `⬜ later`

| Milestone | Benefit delivered | Capacity | State | Evidence / exit |
| --- | --- | ---: | --- | --- |
| **A — One-click local core** | Authorized direct/adaptive video can become one local MP4 | shipped | ✅ | Direct MP4, HLS, DASH, split-track paths and installer are present |
| **B — Resilient native processing** | Long, live, failing, and codec-mixed jobs remain controllable | shipped | ✅ | OCVD-001–006 released; automated/native smoke coverage exists |
| **C — Usable multi-job release** | Clear filenames and up to three independent downloads work in Windows Chrome | shipped | ✅ | OCVD-017/018 released and browser-verified in `BACKLOG.md` |
| **D — Correct-playback compatibility baseline** | Supported browsers keep jobs alive, select only the current playback group, and adapt to installed FFmpeg capabilities | 18 days | ▶ | Local fixtures + OCVD-007/008/009; browser and native evidence recorded |
| **E — Broader common-media correctness** | Generic direct responses are detected safely and intended audio is selected | 7 days | ⬜ | OCVD-010/011 pass positive and negative local fixtures |
| **F — Explicit extractor maintenance** | Optional yt-dlp failures and reviewed updates are diagnosable and reversible | 3 days | ⬜ | OCVD-013 passes a local generic-extractor lifecycle |
| **Reserve** | Absorb release/compatibility surprises without moving the deadline | 2 days | protected | Used only at a retrospective with the reason recorded |

The critical path is **D → E → F**. Only D is implementation-ready. E and F stay
coarse until the preceding release retrospective.

## D — Correct-playback compatibility baseline ▶

**Capacity ceiling:** 18 maintainer-days.

**Value shipped:** a user on the declared browser floor can start a long native
job, close and reopen the popup, and still receive media from the intended current
document/player; supported FFmpeg installations receive only options they
understand.

**Risky assumption retired:** document/frame/navigation evidence plus a bounded
playback-group policy can prevent stale, ad, iframe, and cross-player selection
without exposing resources or adding a site-specific chooser to the popup.

### Protected scope

1. Build a localhost-only browser fixture harness for D's current and failure
   paths: direct MP4, split tracks, HLS/DASH, long jobs, SPA navigation,
   ad-before-content, two players, iframes, and representative FFmpeg profiles.
2. Reconfirm the extension lifecycle requirements against current official
   browser documentation, declare the honest minimum version, align user docs,
   and prove a native job beyond the worker idle window survives popup close/reopen
   without timer traffic.
3. Scope every candidate and copied header context to a document, frame,
   navigation generation, and deterministic playback group. Never pair video and
   audio across those boundaries.
4. Replace lexical/tab-wide selection shortcuts that let stale content or an ad
   outrank the current compatible group while preserving one automatic choice.
5. Inspect and cache the installed FFmpeg HTTP protocol capabilities, generate
   network arguments from the supported set, and retain bounded application-level
   recovery when optional flags are absent.
6. Preserve the direct-MP4 path, optional permissions, redaction, partial-file
   validation, cancellation, live finalization, and concurrency behavior.

The fixture harness is an enabling slice inside this release, not the release by
itself. D is not shipped until the user-visible correctness and lifecycle benefit
passes through the extension and native host.

### Protected cut line

If D reaches its ceiling, cut in this order:

1. Defer fixtures used only by E or F; retain every fixture needed to prove D.
2. Reduce browser-matrix breadth to the explicitly documented supported matrix;
   never weaken wrong-media, secret-handling, output-integrity, or long-job checks.
3. Defer diagnostics polish that is not required for an actionable failure.

Do **not** cut document/frame isolation, cross-group pairing prevention,
FFmpeg-option negotiation, the honest browser floor, or redaction evidence.

### D acceptance evidence

- One project-`.venv` command starts deterministic fixtures without internet,
  third-party media, accounts, or usable credentials.
- The manifest and documentation agree on the supported Chrome/Edge floor, and
  lower versions are rejected rather than silently unreliable.
- A native job lasting longer than 30 seconds remains connected when the popup is
  closed; reopening shows the same job and truthful state.
- Reload, History API navigation, ad-before-content, iframe, two-player, and
  split-track fixtures cannot select or pair media across document/playback groups.
- Mock legacy/current FFmpeg protocol outputs produce only supported flags; a real
  installed build passes the native HTTP/FFmpeg smoke test.
- No candidate URL, copied header, cookie, private manifest, or signed token crosses
  navigation/session boundaries or appears in logs, persisted job views, fixtures,
  screenshots, or release evidence.
- `npm test`, the localhost HTTP/FFmpeg smoke suite, clean host installation, and
  the recorded supported-browser checklist pass.
- README, GitBook docs, landing-page compatibility copy, `CODEX.md`, `CONTEXT.md`,
  `BACKLOG.md`, manifest/version data, and release evidence agree.

## E — Broader common-media correctness ⬜

**Capacity ceiling:** 7 maintainer-days.

**Value shipped:** authorized direct media served through XHR/fetch or generic MIME
types can be selected without misclassifying arbitrary downloads, and HLS/DASH
with several audio tracks uses the intended default/language/main track.

Candidate scope is OCVD-010/011: confidence-based response classification with
negative fixtures, richer ffprobe stream intent, browser-language preference,
explicit audio mapping, and unchanged behavior for ordinary single-audio media.

**Assumption retired:** bounded response metadata and stream disposition/language
are sufficient to improve common coverage without inspecting bodies or adding a
normal-path setting.

## F — Explicit extractor maintenance ⬜

**Capacity ceiling:** 3 maintainer-days.

**Value shipped:** when the optional page extractor matters, the user can
distinguish unsupported-page behavior from a version mismatch and perform a
reviewed, explicit upgrade or rollback inside the production `.venv`.

Candidate scope is OCVD-013: installed/pinned/recommended version reporting,
explicit upgrade and rollback commands, a localhost generic-extractor fixture,
and progress/cancel/cookie-cleanup regression coverage. Auto-update, remote
components, user config, and plugin directories remain disabled.

**Assumption retired:** an explicit pinned maintenance path is enough to keep the
optional fallback usable without turning dependency churn into the normal product
path.

## Definition of done for every release

A milestone ships only when:

- Its end-to-end user benefit works on local maintainer-owned fixtures from a
  clean supported environment; infrastructure alone is not a release.
- The smallest relevant tests, full `npm test`, and HTTP/FFmpeg smoke tests pass;
  browser-facing behavior has recorded desktop evidence with exact versions.
- No real cookie, authorization header, signed URL, private manifest/title, or
  third-party media is present in source, fixtures, snapshots, logs, screenshots,
  CI artifacts, storage evidence, or release notes.
- Direct MP4 remains browser-managed; native work remains shell-free, bounded,
  cancelable, and validated before final-file promotion.
- Permission and host scope is no broader or longer-lived than the delivered
  benefit requires.
- README, contributor guidance, GitBook docs, landing-page copy, `BACKLOG.md`,
  `TASKS.md`, this roadmap, manifests, and version/release evidence agree.
- The release commit/tag and verification evidence are recorded in the milestone
  table. Completion requires proof, not intent.

## Retrospective and re-plan cadence

Run a checkpoint after each release, or after **seven maintainer-days** without a
release, whichever comes first.

At each checkpoint:

1. Review wrong/stale selections, cross-frame or cross-player pairing, worker/native
   disconnects, FFmpeg option failures, corrupt/partial outputs, credential
   exposure, permission friction, browser-matrix results, and capacity spent.
2. Decide whether the milestone's risky assumption was supported, contradicted,
   or remains untested.
3. Re-cut remaining scope inside the fixed deadline and 30-day capacity. Detail
   only the next milestone.
4. Update the milestone table, evidence, remaining capacity, review date, and cut
   line in both roadmap files.

Any credential leak, unapproved host request, wrong-media “success,” corrupt
completion, or cross-document header reuse interrupts feature work immediately.
The correction replaces planned scope; the deadline and capacity do not move.

## Explicitly parked

These are outside the fixed frame unless their activation evidence is reproduced
and a new roadmap is approved:

- OCVD-014 portable playback/HDR policy without a valid-but-unplayable or incorrect
  HDR fixture.
- OCVD-015 broader frame-aware deep injection without an authorized child-frame
  Blob failure that normal detection and yt-dlp cannot handle.
- OCVD-016 signed-URL reacquisition without a reproducible authorized rotating-token
  fixture.
- DRM/paywall/access-control circumvention, credential automation, browser-profile
  database access, or downloading media the user cannot already access and is not
  authorized to save.
- Batch crawling, playlists, unbounded queues, cloud conversion/storage, remote
  parser/plugins, proxies, public APIs, analytics, or retained browsing/download
  history.
- Custom HLS segment engines, WebSocket/WebTransport reconstruction, silent binary
  updates, and site-specific extractor catalogs.
- Video editing, compression controls, media-library management, or a general
  network-inspector interface.
