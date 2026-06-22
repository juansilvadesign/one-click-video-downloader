#!/usr/bin/env python3
"""Install the native host for the browser running on this operating system."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shlex
import shutil
import stat
import subprocess
import sys
import venv
from pathlib import Path

HOST_NAME = "io.local.one_click_video_downloader"
EXTENSION_ID_PATTERN = re.compile(r"^[a-p]{32}$")
BROWSERS = ("chrome", "chromium", "edge", "brave")


def validate_extension_id(value: str) -> str:
    value = value.strip().lower()
    if not EXTENSION_ID_PATTERN.fullmatch(value):
        raise argparse.ArgumentTypeError("Extension ID must be 32 letters in Chrome's a-p alphabet")
    return value


def installation_root(system: str | None = None) -> Path:
    system = system or platform.system()
    if system == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "OneClickVideoDownloader"
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "OneClickVideoDownloader"
    return Path.home() / ".local" / "share" / "one-click-video-downloader"


def manifest_locations(browser: str, system: str | None = None) -> list[Path]:
    system = system or platform.system()
    if system == "Windows":
        return [installation_root(system) / f"{HOST_NAME}.json"]
    if system == "Darwin":
        roots = {
            "chrome": Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
            "chromium": Path.home() / "Library" / "Application Support" / "Chromium",
            "edge": Path.home() / "Library" / "Application Support" / "Microsoft Edge",
            "brave": Path.home() / "Library" / "Application Support" / "BraveSoftware" / "Brave-Browser",
        }
    else:
        roots = {
            "chrome": Path.home() / ".config" / "google-chrome",
            "chromium": Path.home() / ".config" / "chromium",
            "edge": Path.home() / ".config" / "microsoft-edge",
            "brave": Path.home() / ".config" / "BraveSoftware" / "Brave-Browser",
        }
    return [roots[browser] / "NativeMessagingHosts" / f"{HOST_NAME}.json"]


def windows_registry_keys(browser: str) -> list[str]:
    roots = {
        "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
        "chromium": r"Software\Chromium\NativeMessagingHosts",
        "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
        "brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    }
    return [f"{roots[browser]}\\{HOST_NAME}"]


def production_python(root: Path, system: str | None = None) -> Path:
    system = system or platform.system()
    return root / ".venv" / ("Scripts/python.exe" if system == "Windows" else "bin/python")


def create_launcher(
    root: Path,
    host_script: Path,
    python_executable: Path,
    system: str | None = None,
) -> Path:
    system = system or platform.system()
    if system == "Windows":
        launcher = root / "host-launcher.bat"
        launcher.write_text(
            f'@echo off\r\n"{python_executable}" "{host_script}" %*\r\n',
            encoding="utf-8",
        )
    else:
        launcher = root / "host-launcher.sh"
        launcher.write_text(
            "#!/bin/sh\n"
            f"exec {shlex.quote(str(python_executable))} {shlex.quote(str(host_script))} \"$@\"\n",
            encoding="utf-8",
        )
        launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR)
    return launcher.resolve()


def manifest_payload(extension_id: str, launcher: Path) -> dict:
    return {
        "name": HOST_NAME,
        "description": "Local FFmpeg host for One-Click Video Downloader",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }


def register_windows_manifest(browser: str, manifest_path: Path) -> None:
    import winreg

    for key_name in windows_registry_keys(browser):
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_name) as key:
            winreg.SetValueEx(key, None, 0, winreg.REG_SZ, str(manifest_path))


def unregister_windows_manifest(browser: str) -> None:
    import winreg

    for key_name in windows_registry_keys(browser):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_name)
        except FileNotFoundError:
            pass


def install_optional_yt_dlp(python_executable: Path) -> None:
    requirements = Path(__file__).resolve().parents[1] / "requirements-yt-dlp.txt"
    if not requirements.exists():
        raise FileNotFoundError(f"Missing optional dependency lock file: {requirements}")
    subprocess.run(
        [str(python_executable), "-m", "ensurepip", "--upgrade"],
        check=True,
    )
    subprocess.run(
        [
            str(python_executable), "-m", "pip", "install",
            "--disable-pip-version-check", "--requirement", str(requirements),
        ],
        check=True,
    )


def install(extension_id: str, browser: str, *, with_yt_dlp: bool = False) -> list[Path]:
    system = platform.system()
    root = installation_root(system)
    root.mkdir(parents=True, exist_ok=True)

    source_host = Path(__file__).with_name("one_click_video_host.py")
    installed_host = root / source_host.name
    shutil.copy2(source_host, installed_host)
    python_executable = production_python(root, system)
    if not python_executable.exists():
        venv.EnvBuilder(with_pip=False).create(root / ".venv")
    if with_yt_dlp:
        install_optional_yt_dlp(python_executable)
    launcher = create_launcher(root, installed_host, python_executable, system)
    payload = manifest_payload(extension_id, launcher)

    locations = manifest_locations(browser, system)
    for location in locations:
        location.parent.mkdir(parents=True, exist_ok=True)
        location.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        if system == "Windows":
            register_windows_manifest(browser, location.resolve())
    return locations


def uninstall(browser: str) -> list[Path]:
    system = platform.system()
    locations = manifest_locations(browser, system)
    for location in locations:
        location.unlink(missing_ok=True)
    if system == "Windows":
        unregister_windows_manifest(browser)
    return locations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=BROWSERS, default="chrome")
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument(
        "--with-yt-dlp",
        action="store_true",
        help="install the pinned optional page extractor into the production .venv",
    )
    parser.add_argument("--extension-id", type=validate_extension_id)
    args = parser.parse_args()
    if not args.uninstall and not args.extension_id:
        parser.error("--extension-id is required when installing")
    return args


def main() -> int:
    args = parse_args()
    if args.uninstall:
        locations = uninstall(args.browser)
        print(f"Unregistered {HOST_NAME} from {args.browser}:")
    else:
        locations = install(args.extension_id, args.browser, with_yt_dlp=args.with_yt_dlp)
        print(f"Registered {HOST_NAME} for {args.browser}:")
    for location in locations:
        print(f"  {location}")

    if not args.uninstall:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            print(f"FFmpeg: {ffmpeg}")
        else:
            print("WARNING: FFmpeg is not on PATH for this operating system.", file=sys.stderr)
        if args.with_yt_dlp:
            print("yt-dlp: installed from requirements-yt-dlp.txt in the production .venv")
        print("Reload the extension from the browser's extensions page.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
