# Contributing to One-Click Video Downloader

Contributions are welcome when they preserve the project's core behavior: one explicit user action should save one authorized video locally without exposing downloader-engine or codec decisions during the normal path.

## Ways to contribute

- Report reproducible detection, download, merge, or installation bugs.
- Add legal, local test fixtures for media formats and failure conditions.
- Improve Windows, Linux, macOS, Chrome, or Edge setup documentation.
- Improve accessibility and clarity in the popup.
- Implement an item already described in [BACKLOG.md](BACKLOG.md).
- Propose a narrowly scoped compatibility improvement with evidence from an authorized page.

DRM circumvention, paywall bypass, credential automation, remote code execution, and silent binary updates are out of scope.

## Development setup

Python must run from this project's `.venv` for development, tests, and setup. The installed native host uses a separate production `.venv` created by the installer.

Linux or WSL:

```bash
cd knowledge/projects/one-click-video-downloader
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm test
```

Windows PowerShell:

```powershell
cd knowledge\projects\one-click-video-downloader
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm test
```

Requirements:

- Python 3.10 or newer.
- Node.js 20 or newer for JavaScript tests.
- FFmpeg and ffprobe on `PATH` for native integration tests.
- Chrome or Edge for the final manual extension test.

The optional yt-dlp fallback is not required for the normal test suite. Do not add it to `requirements.txt`; its production pin belongs in `requirements-yt-dlp.txt` and is installed only through `install_host.py --with-yt-dlp`.

## Development workflow

1. Fork and clone the repository.
2. Create a focused branch such as `fix/live-stop-finalization` or `feature/hls-blob-detection`.
3. Make the smallest coherent change that solves the demonstrated problem.
4. Add or update automated tests.
5. Run the full test suite and relevant smoke tests.
6. Manually load `extension/` as an unpacked extension when browser behavior changes.
7. Open a pull request explaining the user-visible behavior, security impact, and verification performed.

Do not commit `.venv`, downloaded media, cookies, authorization headers, signed media URLs, native-host manifests containing personal extension IDs, or third-party binaries.

## Architecture boundaries

- Keep direct MP4 downloads on `chrome.downloads` unless a reproduced browser failure requires the native fallback.
- Keep media bytes out of Native Messaging. Messages may carry URLs, allowlisted request headers, job control, bounded inline HLS text, and progress state.
- Invoke FFmpeg, ffprobe, and yt-dlp with argument arrays and `shell=False` behavior.
- Accept only HTTP(S) remote inputs. Local manifest files must be created internally from validated, size-limited HLS text.
- Write incomplete output as a partial file and promote it only after successful validation.
- Keep cookie access opt-in, temporary, permission-scoped, and deleted on every terminal path.
- Declare privileged Chrome capabilities as optional unless the normal detector requires them.
- Keep yt-dlp pinned, configuration-independent, plugin-disabled, and explicit to install or upgrade.

Reference repositories under `knowledge/sources/video-downloader-extension/` are research inputs, not a copy source. Preserve license provenance and do not copy code from AGPL or MPL projects without first documenting and satisfying the resulting obligations. GPL-derived material must retain attribution and remain compatible with this project's GPL-3.0 license.

## Code and test standards

- Follow the existing JavaScript module and Python standard-library style.
- Prefer pure functions for candidate selection, command construction, validation, and state transitions.
- Keep user-facing errors concise and redact URLs, cookies, authorization values, and tokens.
- Add deterministic unit tests for security rules and command arrays.
- Use real FFmpeg fixtures for container, codec, merge, cancellation, or finalization behavior when practical.
- Never make tests depend on third-party media sites or personal accounts.

Run before submitting:

```bash
npm test
.venv/bin/python tests/http_smoke.py
```

The localhost smoke test may be skipped only when the environment forbids binding a local port; state that explicitly in the pull request.

For browser-facing changes, also verify:

- Direct MP4 still uses Chrome's download manager.
- HLS/DASH or split tracks complete through the production native-host `.venv`.
- Closing and reopening the popup preserves visible job state.
- Cancel, live stop, errors, and host disconnects release any power request.
- No secret values appear in the popup, console, test output, or native-host errors.

## Bug reports

Include:

- Operating system and version.
- Chrome or Edge version.
- Python, FFmpeg, and ffprobe versions.
- Whether yt-dlp fallback or deep detection was enabled.
- Exact steps to reproduce with a legal public fixture when possible.
- Expected and actual behavior.
- Sanitized error text and relevant screenshots.

Do not attach cookies, tokens, private manifests, private video URLs, or paid/private media. Replace sensitive URLs and headers with clear placeholders.

## Feature requests

Explain the authorized use case, the current failure mode, why the existing detector and yt-dlp fallback do not solve it, and the smallest proposed capability. Features that expand permissions, inject page code, or add a new executable dependency must include a threat analysis and an opt-in design.

## Commits and pull requests

Use imperative, descriptive commit subjects, for example:

```text
Handle graceful live-stream finalization
```

A pull request should include:

- What behavior changed and why.
- The related issue or backlog item.
- Security and permission changes.
- Automated tests and manual platforms tested.
- Screenshots for popup changes.
- Known limitations or follow-up work.

Keep unrelated refactors out of the same pull request. Review feedback may request smaller changes or additional fixtures when media behavior is not reproducible.

## Licensing

This project is licensed under the [GNU General Public License v3.0](LICENSE). By submitting a contribution, you agree that it will be distributed under GPL-3.0, confirm that you have the right to provide it, and disclose the provenance and license of any adapted material.
