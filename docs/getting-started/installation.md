---
description: Load the unpacked extension and register the local native host.
---

# Installation

Installation is two parts: load the unpacked extension, then install the native
host that handles adaptive and split media. Make sure you meet the
[requirements](requirements.md) first.

## 1. Load the extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** in the upper-right corner.
3. Choose **Load unpacked** and select the project's `extension/` folder.
4. Find **One-Click Video Downloader** and copy its 32-character extension ID.

{% hint style="info" %}
The native host registration is restricted to this exact extension ID. If the ID
later changes, rerun the installer with the new ID.
{% endhint %}

## 2. Install the native host

The installer copies the host into a user-local directory, creates a dedicated
production `.venv`, generates its launcher, and registers the Native Messaging
manifest for your extension ID.

{% tabs %}
{% tab title="Linux / WSL" %}
```bash
.venv/bin/python native-host/install_host.py \
  --extension-id YOUR_EXTENSION_ID \
  --browser chrome \
  --with-yt-dlp
```

Use `--browser edge`, `chromium`, or `brave` when appropriate.
{% endtab %}

{% tab title="Windows (PowerShell)" %}
```powershell
.\.venv\Scripts\python.exe native-host\install_host.py `
  --extension-id YOUR_EXTENSION_ID `
  --browser chrome `
  --with-yt-dlp
```
{% endtab %}

{% tab title="WSL repo + Windows Chrome" %}
Run the installer with **Windows** Python, not WSL Python:

```bash
py.exe -3 "$(wslpath -w native-host/install_host.py)" \
  --extension-id YOUR_EXTENSION_ID \
  --browser chrome \
  --with-yt-dlp
```

Windows FFmpeg must be on the Windows `PATH`; FFmpeg inside WSL is invisible to
Windows Chrome.
{% endtab %}
{% endtabs %}

`--with-yt-dlp` is optional. It installs the exact version pinned in
`requirements-yt-dlp.txt` into the production `.venv`. Omit it if normal network
detection covers your sites; the extension stays fully usable without the page
fallback.

## 3. Restart and verify

1. Fully close every browser window (confirm it is not still running).
2. Start the browser again and return to the extensions page.
3. Press the extension's **Reload** button, then pin and open it.

The popup footer should show FFmpeg and ffprobe versions. If it still reports the
native host as unavailable, see [Troubleshooting](../reference/troubleshooting.md).

## Updating or removing the host

After pulling changes that modify `native-host/`, rerun the install command and
restart the browser. Include `--with-yt-dlp` to install or upgrade the pinned
version; the host never updates it silently.

To unregister the host:

```bash
.venv/bin/python native-host/install_host.py --uninstall --browser chrome
```

Run the uninstall command with Windows Python when unregistering Windows Chrome.
