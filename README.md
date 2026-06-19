# One-Click Video Downloader

A personal Manifest V3 extension that detects authorized page video, selects the best available candidate, and saves a local MP4 through one primary action.

This is an MVP. It is intentionally smaller than Cat Catch: the resource list, manual parser controls, capture scripts, cloud features, and site-specific workarounds are replaced by one automatic plan.

Planned reliability and compatibility work is tracked in [BACKLOG.md](BACKLOG.md).

## What works

- Direct MP4 detection and browser-managed download.
- HLS (`.m3u8`) and DASH (`.mpd`) detection.
- Automatic pairing of separately detected video and audio.
- Local FFmpeg remuxing with transcoding only when the MP4 container rejects the original codecs.
- Local progress and completion messages through Chrome Native Messaging.
- Authenticated requests using an allowlisted copy of Cookie, Authorization, Origin, Referer, and User-Agent headers.
- Unique, sanitized filenames in the host operating system's Downloads directory.

DRM bypass, credential automation, batch download, and site-specific extractors are explicitly outside this project.

## How it works

```text
page requests
    │
    ▼
extension detector ──► best candidate plan
                          ├─ direct MP4 ──► chrome.downloads
                          └─ HLS / DASH / split tracks
                                           │
                                           ▼
                                  Native Messaging host
                                           │
                                           ▼
                                  local FFmpeg ──► Downloads/*.mp4
```

Media bytes never pass through Native Messaging. The extension sends URLs and selected request headers; the host lets FFmpeg retrieve and process the media directly.

## Requirements

- Chrome or Edge 102+.
- Python 3.10+ on the same operating system that runs the browser.
- FFmpeg and ffprobe on that operating system's `PATH`.
- Node.js 20+ only for development tests.

Both test and production Python run from a `.venv` directory. There are currently no third-party Python packages.

## Windows + Chrome: complete setup

Use this section when both the cloned repository and Google Chrome run directly on Windows. It does not apply when the repository is inside WSL; that case is covered under [Install the production native host](#install-the-production-native-host).

### 1. Check the Windows prerequisites

Install [Python 3.10 or newer](https://www.python.org/downloads/windows/) and a Windows build of [FFmpeg](https://ffmpeg.org/download.html#build-windows). FFmpeg's `bin` directory must be included in the Windows `PATH`.

Open a new PowerShell window and verify all three commands:

```powershell
py -3 --version
ffmpeg -version
ffprobe -version
```

If FFmpeg was just added to `PATH`, completely close Chrome before continuing. Chrome passes its environment to the native host, so an already-running browser may retain the old `PATH`.

### 2. Create the project test `.venv`

From the cloned repository:

```powershell
cd knowledge\projects\one-click-video-downloader
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The requirements file is intentionally empty except for documentation; creating the `.venv` is still mandatory so test and setup commands never depend on an uncontrolled global interpreter.

Optional verification for contributors with Node.js 20+:

```powershell
node --test tests\manifest.test.mjs tests\media.test.mjs
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

### 3. Load the extension into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the upper-right corner.
3. Select **Load unpacked**.
4. Choose `knowledge\projects\one-click-video-downloader\extension` inside the clone.
5. Find **One-Click Video Downloader** and copy its 32-character extension ID.

Chrome's official unpacked-extension workflow is documented [here](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

### 4. Install the production native host

Run the installer with the project `.venv`, replacing the placeholder with the ID copied from Chrome:

```powershell
.\.venv\Scripts\python.exe native-host\install_host.py `
  --extension-id YOUR_EXTENSION_ID `
  --browser chrome
```

The installer performs four local actions:

- Copies the native host to `%LOCALAPPDATA%\OneClickVideoDownloader`.
- Creates `%LOCALAPPDATA%\OneClickVideoDownloader\.venv` for production.
- Generates a launcher bound to that production interpreter.
- Registers the host under the current user's Chrome Native Messaging registry key, restricted to the copied extension ID.

The repository `.venv` is for setup and testing. The `%LOCALAPPDATA%` `.venv` is the production environment Chrome launches.

### 5. Restart and verify Chrome

1. Close every Chrome window and confirm Chrome is no longer running in Task Manager.
2. Start Chrome again and return to `chrome://extensions`.
3. Press the extension's **Reload** button.
4. Pin and open the extension.

The popup footer should show an FFmpeg version. If it still says the native host is unavailable, use the troubleshooting section below.

### 6. Download a video

1. Open a page containing a video you are authorized to save.
2. Start playback so the page requests its media resources.
3. Open **One-Click Video Downloader**.
4. Select **Download best quality**.

Direct MP4 files use Chrome's download manager. HLS, DASH, non-MP4, or separate audio/video resources are processed by the local production host and saved under `%USERPROFILE%\Downloads`.

### Updating or removing the Windows host

After pulling changes that modify `native-host\`, rerun the installation command and restart Chrome. The installer refreshes the copied production host.

To unregister it:

```powershell
.\.venv\Scripts\python.exe native-host\install_host.py --uninstall --browser chrome
```

### Windows troubleshooting

- **“Specified native messaging host not found”** — confirm the extension ID, rerun step 4, then fully restart Chrome. Reloading only the extension may not be sufficient.
- **“FFmpeg is not available on PATH”** — confirm both `ffmpeg -version` and `ffprobe -version` work in a new PowerShell window, then fully restart Chrome.
- **The extension ID changed** — rerun the installer with the new ID; the host deliberately rejects every extension origin except the registered one.
- **Chrome downloads the video but FFmpeg jobs fail** — keep the source page open and authenticated until processing completes. Signed media URLs and cookies may expire.
- **The repository was moved** — the installed host keeps working because it was copied to `%LOCALAPPDATA%`. Rerun the installer only when its source changes or the extension ID changes.

## Development setup

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
node --test tests\manifest.test.mjs tests\media.test.mjs
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

## Install the unpacked extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's `extension/` folder.
4. Copy the generated 32-character extension ID. The native host registration is restricted to this ID.

## Install the production native host

The installer copies the host into a user-local application directory, creates a dedicated production `.venv`, generates its launcher, and registers the Native Messaging manifest.

If Chrome runs on Linux:

```bash
.venv/bin/python native-host/install_host.py \
  --extension-id YOUR_EXTENSION_ID \
  --browser chrome
```

Use `--browser edge`, `chromium`, or `brave` when appropriate.

If Chrome runs on Windows while this repository is inside WSL, run the installer with **Windows Python**, not WSL Python:

```bash
py.exe -3 "$(wslpath -w native-host/install_host.py)" \
  --extension-id YOUR_EXTENSION_ID \
  --browser chrome
```

This creates `%LOCALAPPDATA%\OneClickVideoDownloader\.venv` and registers the host in the current Windows user's browser registry. Windows FFmpeg must also be on the Windows `PATH`; the FFmpeg installed inside WSL is not visible to Windows Chrome.

After installation, reload the extension from the browser's extensions page. Opening the popup should show an FFmpeg version instead of a host error.

To unregister the host:

```bash
.venv/bin/python native-host/install_host.py --uninstall --browser chrome
```

Run the uninstall command with Windows Python when unregistering Windows Chrome.

## Use

1. Open a page containing a video you are authorized to save.
2. Start playback so the page requests its media.
3. Open the extension popup.
4. Press **Download best quality**.
5. Keep the source tab open while authenticated media is processed.

Direct MP4 files use the browser downloader. Adaptive or split streams continue through the native host even if the popup closes.

## Verification

`npm test` runs:

- Candidate classification and highest-quality plan selection tests.
- Manifest reference and permission checks.
- Native protocol, URL, header, command-construction, and installer tests.
- A real FFmpeg integration test that creates separate video/audio fixtures and verifies the merged MP4 contains both streams.

Final browser verification must happen on the desktop browser because this WSL environment has no GUI Chromium installation.

An optional localhost smoke test exercises the complete HTTP retrieval and native FFmpeg job. Run it where binding a local test port is allowed:

```bash
.venv/bin/python tests/http_smoke.py
```

## Security and provenance

- Only HTTP(S) media inputs are accepted by the host.
- Captured header values containing newlines are rejected.
- FFmpeg is invoked with an argument array, never through a shell.
- The host manifest allows only the selected extension ID.
- Everything stays local; no analytics or remote service is used.

The detector architecture is informed by the local Cat Catch source at `knowledge/sources/video-downloader-extension/cat-catch`. Cat Catch is GPL-3.0 licensed. This personal prototype does not include the upstream extension's files and is not packaged for redistribution; review derivative-work and GPL obligations before distributing it.
