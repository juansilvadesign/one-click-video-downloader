#!/usr/bin/env python3
"""Native Messaging host for local FFmpeg and optional yt-dlp jobs."""

from __future__ import annotations

import atexit
import importlib.metadata
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Callable, Iterator
from urllib.parse import urljoin, urlparse

HOST_NAME = "io.local.one_click_video_downloader"
MAX_INCOMING_MESSAGE = 64 * 1024 * 1024
MAX_INLINE_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_COOKIES = 5_000
ALLOWED_HEADERS = {"authorization", "cookie", "origin", "referer", "user-agent"}
HTTP_RETRY_ATTEMPTS = 3
PROBE_TIMEOUT_SECONDS = 25
GRACEFUL_STOP_SECONDS = 5
MP4_VIDEO_COPY_CODECS = {"av1", "h264", "hevc", "mpeg4"}
MP4_AUDIO_COPY_CODECS = {"aac", "mp3"}
NETWORK_INPUT_OPTIONS = [
    "-rw_timeout", "30000000",
    "-reconnect", "1",
    "-reconnect_on_network_error", "1",
    "-reconnect_on_http_error", "408,429,5xx",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
]


class HostError(RuntimeError):
    pass


def read_message(stream: BinaryIO) -> dict | None:
    raw_length = stream.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise HostError("Incomplete Native Messaging frame header")
    (length,) = struct.unpack("=I", raw_length)
    if length > MAX_INCOMING_MESSAGE:
        raise HostError("Native Messaging request exceeds 64 MiB")
    payload = stream.read(length)
    if len(payload) != length:
        raise HostError("Incomplete Native Messaging frame payload")
    return json.loads(payload.decode("utf-8"))


def write_message(stream: BinaryIO, message: dict) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    stream.write(struct.pack("=I", len(payload)))
    stream.write(payload)
    stream.flush()


def sanitize_filename(value: str, fallback: str = "video") -> str:
    cleaned = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", " ", str(value or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).rstrip(". ").strip()
    return (cleaned or fallback)[:160]


def download_directory() -> Path:
    configured = os.environ.get("ONE_CLICK_VIDEO_DOWNLOAD_DIR")
    return Path(configured).expanduser() if configured else Path.home() / "Downloads"


def unique_output_path(directory: Path, title: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stem = sanitize_filename(title)
    candidate = directory / f"{stem}.mp4"
    counter = 1
    def collides(path: Path) -> bool:
        partial_prefix = f"{path.stem}.part."
        return path.exists() or any(item.name.startswith(partial_prefix) for item in directory.iterdir())

    while collides(candidate):
        candidate = directory / f"{stem} ({counter}).mp4"
        counter += 1
    return candidate


def validated_url(value: str) -> str:
    parsed = urlparse(value) if isinstance(value, str) else None
    if not parsed or parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise HostError("Only HTTP(S) media URLs are accepted")
    if parsed.username or parsed.password:
        raise HostError("Credentials must be passed through the allowlisted header channel")
    return value


def ffmpeg_header_block(headers: dict | None) -> str:
    lines: list[str] = []
    for raw_name, raw_value in (headers or {}).items():
        name = str(raw_name).lower()
        value = str(raw_value)
        if name not in ALLOWED_HEADERS or not value:
            continue
        if "\r" in value or "\n" in value:
            raise HostError(f"Invalid newline in {name} header")
        canonical = "-".join(part.capitalize() for part in name.split("-"))
        lines.append(f"{canonical}: {value}")
    return "\r\n".join(lines) + ("\r\n" if lines else "")


def input_arguments(media_input: dict, *, live: bool = False) -> list[str]:
    local_manifest = media_input.get("_local_manifest")
    url = str(local_manifest) if local_manifest else validated_url(media_input.get("url", ""))
    headers = ffmpeg_header_block(media_input.get("headers"))
    arguments: list[str] = []
    if local_manifest:
        arguments.extend(["-protocol_whitelist", "file,http,https,tcp,tls,crypto,data"])
    else:
        arguments.extend(NETWORK_INPUT_OPTIONS)
        if live:
            arguments.extend(["-reconnect_at_eof", "1"])
    if headers:
        arguments.extend(["-headers", headers])
    arguments.extend(["-i", url])
    return arguments


def selected_stream(metadata: dict, codec_type: str) -> dict | None:
    streams = [stream for stream in metadata.get("streams", []) if stream.get("codec_type") == codec_type]
    if codec_type == "video":
        score = lambda stream: (
            int(stream.get("width") or 0) * int(stream.get("height") or 0),
            int(stream.get("bit_rate") or 0),
        )
    else:
        score = lambda stream: (int(stream.get("channels") or 0), int(stream.get("bit_rate") or 0))
    return max(streams, key=score, default=None)


def codec_strategy(kind: str, metadata: list[dict]) -> dict:
    video_metadata = metadata[0] if metadata else {}
    audio_metadata = metadata[1] if kind == "merge" and len(metadata) > 1 else video_metadata
    video_stream = selected_stream(video_metadata, "video")
    audio_stream = selected_stream(audio_metadata, "audio")
    video_codec = str((video_stream or {}).get("codec_name") or "").lower()
    audio_codec = str((audio_stream or {}).get("codec_name") or "").lower()
    video_mode = "copy" if not video_codec or video_codec in MP4_VIDEO_COPY_CODECS else "libx264"
    audio_mode = "copy" if not audio_codec or audio_codec in MP4_AUDIO_COPY_CODECS else "aac"
    return {
        "video": video_mode,
        "audio": audio_mode,
        "has_audio": audio_stream is not None if metadata else None,
        "video_codec": video_codec or "unknown",
        "audio_codec": audio_codec or "none",
        "transcoding": video_mode != "copy" or audio_mode != "copy",
    }


def build_ffmpeg_command(
    ffmpeg: str,
    job: dict,
    temporary_output: Path,
    *,
    codec_plan: dict | None = None,
    transcode: bool = False,
    live: bool = False,
) -> list[str]:
    inputs = job.get("inputs") or []
    kind = job.get("kind")
    if kind not in {"direct", "manifest", "merge"}:
        raise HostError(f"Unsupported job kind: {kind}")
    if not inputs or (kind == "merge" and len(inputs) < 2):
        raise HostError("The selected job does not contain the required inputs")

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-progress", "pipe:1",
        "-nostats",
    ]
    for media_input in inputs[:2] if kind == "merge" else inputs[:1]:
        command.extend(input_arguments(media_input, live=live))

    if kind == "merge":
        command.extend(["-map", "0:v:0", "-map", "1:a:0"])

    if transcode:
        command.extend([
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k",
        ])
    elif codec_plan:
        if codec_plan.get("video") == "libx264":
            command.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
        else:
            command.extend(["-c:v", "copy"])
        if codec_plan.get("has_audio") is False:
            command.append("-an")
        elif codec_plan.get("audio") == "aac":
            command.extend(["-c:a", "aac", "-b:a", "192k"])
        else:
            command.extend(["-c:a", "copy"])
    else:
        command.extend(["-c", "copy"])
    command.extend(["-movflags", "+faststart", str(temporary_output)])
    return command


def probe_media(ffprobe: str, media_input: dict, *, live: bool = False) -> dict:
    command = [ffprobe, "-v", "error"]
    command.extend(input_arguments(media_input, live=live))
    command.extend([
        "-show_entries",
        "format=duration,format_name,bit_rate:stream=index,codec_type,codec_name,width,height,channels,bit_rate",
        "-of", "json",
    ])
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_SECONDS,
            check=False,
        )
        if result.returncode != 0:
            return {"streams": [], "format": {}}
        metadata = json.loads(result.stdout or "{}")
        metadata.setdefault("streams", [])
        metadata.setdefault("format", {})
        return metadata
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return {"streams": [], "format": {}}


def metadata_duration(metadata: dict) -> float | None:
    try:
        duration = float(metadata.get("format", {}).get("duration"))
        return duration if duration > 0 else None
    except (TypeError, ValueError):
        return None


def probe_duration(ffprobe: str, media_input: dict) -> float | None:
    """Compatibility wrapper retained for callers of the MVP API."""
    return metadata_duration(probe_media(ffprobe, media_input))


def probe_local_output(ffprobe: str, output: Path) -> dict:
    try:
        result = subprocess.run(
            [
                ffprobe, "-v", "error", "-show_entries",
                "format=duration,format_name:stream=codec_type,codec_name,width,height,channels",
                "-of", "json", str(output),
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        return json.loads(result.stdout or "{}") if result.returncode == 0 else {}
    except (OSError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return {}


def valid_output(ffprobe: str, output: Path, *, expect_audio: bool = False) -> bool:
    if not output.exists() or output.stat().st_size <= 0:
        return False
    metadata = probe_local_output(ffprobe, output)
    stream_types = {stream.get("codec_type") for stream in metadata.get("streams", [])}
    return "video" in stream_types and (not expect_audio or "audio" in stream_types)


def should_retry_with_transcode(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(
        marker in lowered
        for marker in (
            "not currently supported in container",
            "could not find tag for codec",
            "codec not supported",
            "incorrect codec parameters",
        )
    )


def is_transient_failure(stderr: str) -> bool:
    lowered = stderr.lower()
    if any(marker in lowered for marker in ("401 unauthorized", "403 forbidden", "invalid data found", "invalid manifest")):
        return False
    return any(
        marker in lowered
        for marker in (
            "connection reset",
            "connection timed out",
            "connection refused",
            "network is unreachable",
            "temporary failure",
            "server returned 408",
            "server returned 429",
            "server returned 500",
            "server returned 502",
            "server returned 503",
            "server returned 504",
            "http error 408",
            "http error 429",
            "i/o error",
        )
    )


class ProcessController:
    """Owns one job's current child process and bounded interruption state."""

    def __init__(self, job_id: str):
        self.job_id = job_id
        self.intent: str | None = None
        self.live = False
        self.forced = False
        self._process: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._interrupted = threading.Event()

    def attach(self, process: subprocess.Popen) -> None:
        with self._lock:
            self._process = process
            intent = self.intent
        if intent:
            self._interrupt(process)

    def detach(self, process: subprocess.Popen) -> None:
        with self._lock:
            if self._process is process:
                self._process = None

    def request(self, intent: str) -> bool:
        if intent not in {"cancel", "stop"}:
            raise HostError("Unsupported job control action")
        with self._lock:
            if self.intent:
                return False
            self.intent = intent
            process = self._process
            self._interrupted.set()
        if process and process.poll() is None:
            self._interrupt(process)
        return True

    def wait_delay(self, seconds: float) -> bool:
        return not self._interrupted.wait(seconds)

    def _interrupt(self, process: subprocess.Popen) -> None:
        try:
            if os.name == "nt" and hasattr(signal, "CTRL_BREAK_EVENT"):
                process.send_signal(signal.CTRL_BREAK_EVENT)
            elif os.name != "nt":
                os.killpg(os.getpgid(process.pid), signal.SIGINT)
            else:
                process.terminate()
        except (OSError, ProcessLookupError):
            try:
                process.terminate()
            except OSError:
                return
        threading.Thread(target=self._force_after_timeout, args=(process,), daemon=True).start()

    def _force_after_timeout(self, process: subprocess.Popen) -> None:
        try:
            process.wait(timeout=GRACEFUL_STOP_SECONDS)
            return
        except subprocess.TimeoutExpired:
            pass
        with self._lock:
            if self._process is not process or process.poll() is not None:
                return
            self.forced = True
        try:
            if os.name != "nt":
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            else:
                process.kill()
        except (OSError, ProcessLookupError):
            pass


def _popen_group_arguments() -> dict:
    if os.name == "nt":
        return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
    return {"start_new_session": True}


def run_ffmpeg(
    command: list[str],
    duration: float | None,
    on_progress: Callable[[float | None, str], None],
    controller: ProcessController | None = None,
    detail: str = "Merging with local FFmpeg",
) -> tuple[int, str]:
    controller = controller or ProcessController("synchronous")
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as error_stream:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=error_stream,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            **_popen_group_arguments(),
        )
        controller.attach(process)
        try:
            assert process.stdout is not None
            progress_values: dict[str, str] = {}
            for raw_line in process.stdout:
                line = raw_line.strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                progress_values[key] = value
                if key == "progress":
                    seconds = 0.0
                    raw_time = progress_values.get("out_time_us") or progress_values.get("out_time_ms")
                    if raw_time and raw_time.isdigit():
                        seconds = int(raw_time) / 1_000_000
                    percentage = min(99.0, seconds / duration * 100) if duration and seconds else None
                    on_progress(percentage, detail)
                    progress_values.clear()
            process.stdout.close()
            return_code = process.wait()
        finally:
            controller.detach(process)
        error_stream.seek(0)
        stderr = error_stream.read()
    return return_code, stderr.strip()


def safe_error(value: str) -> str:
    redacted = re.sub(r"https?://[^\s\]]+", "[media URL]", str(value), flags=re.IGNORECASE)
    redacted = re.sub(r"(?i)(authorization|cookie):[^\r\n]+", r"\1: [redacted]", redacted)
    return redacted[:2_000]


def binary_version(binary: str, name: str) -> str:
    result = subprocess.run([binary, "-version"], capture_output=True, text=True, timeout=5, check=False)
    match = re.search(rf"{re.escape(name)} version\s+([^\s]+)", result.stdout, re.IGNORECASE)
    return match.group(1) if match else "available"


def ffmpeg_version(ffmpeg: str) -> str:
    return binary_version(ffmpeg, "ffmpeg")


def available_encoders(ffmpeg: str) -> set[str]:
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=8, check=False
        )
        return {
            match.group(1)
            for line in result.stdout.splitlines()
            if (match := re.match(r"^\s*[VAS.]\S*\s+(\S+)", line))
        }
    except (OSError, subprocess.TimeoutExpired):
        return set()


def yt_dlp_version() -> str | None:
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return None


def dependency_capabilities() -> dict:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        missing = " and ".join(name for name, path in (("FFmpeg", ffmpeg), ("ffprobe", ffprobe)) if not path)
        raise HostError(f"{missing} must be available on PATH")
    encoders = available_encoders(ffmpeg)
    yt_version = yt_dlp_version()
    return {
        "ffmpeg": {"path": ffmpeg, "version": binary_version(ffmpeg, "ffmpeg")},
        "ffprobe": {"path": ffprobe, "version": binary_version(ffprobe, "ffprobe")},
        "encoders": {"libx264": "libx264" in encoders, "aac": "aac" in encoders},
        "ytDlp": {"available": bool(yt_version), "version": yt_version},
    }


def resolve_hls_manifest(text: str, base_url: str) -> str:
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_INLINE_MANIFEST_BYTES:
        raise HostError("In-memory HLS manifest exceeds the 2 MiB limit")
    if not text.lstrip("\ufeff\r\n\t ").startswith("#EXTM3U"):
        raise HostError("In-memory payload is not a valid HLS manifest")
    validated_url(base_url)

    def resolve_reference(value: str) -> str:
        if value.startswith("data:"):
            return value
        resolved = urljoin(base_url, value)
        return validated_url(resolved)

    resolved_lines: list[str] = []
    uri_pattern = re.compile(r'URI="([^"\r\n]+)"')
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#"):
            resolved_lines.append(resolve_reference(line))
        elif line.startswith("#"):
            resolved_lines.append(uri_pattern.sub(lambda match: f'URI="{resolve_reference(match.group(1))}"', raw_line))
        else:
            resolved_lines.append(raw_line)
    return "\n".join(resolved_lines) + "\n"


@contextmanager
def prepared_job_inputs(job: dict) -> Iterator[dict]:
    temporary_paths: list[Path] = []
    prepared = {**job, "inputs": []}
    try:
        for media_input in job.get("inputs") or []:
            copied = {key: value for key, value in media_input.items() if key not in {"manifestText", "baseUrl"}}
            if "manifestText" in media_input:
                manifest = resolve_hls_manifest(media_input.get("manifestText"), media_input.get("baseUrl", ""))
                handle = tempfile.NamedTemporaryFile(
                    mode="w", suffix=".m3u8", prefix="ocvd-", encoding="utf-8", delete=False
                )
                with handle:
                    handle.write(manifest)
                path = Path(handle.name)
                path.chmod(0o600)
                temporary_paths.append(path)
                copied["_local_manifest"] = str(path)
            prepared["inputs"].append(copied)
        yield prepared
    finally:
        for path in temporary_paths:
            path.unlink(missing_ok=True)


_ephemeral_paths: set[Path] = set()
_ephemeral_lock = threading.Lock()


def _track_ephemeral(path: Path) -> None:
    with _ephemeral_lock:
        _ephemeral_paths.add(path)


def _remove_ephemeral(path: Path) -> None:
    path.unlink(missing_ok=True)
    with _ephemeral_lock:
        _ephemeral_paths.discard(path)


def _cleanup_ephemeral() -> None:
    with _ephemeral_lock:
        paths = list(_ephemeral_paths)
    for path in paths:
        _remove_ephemeral(path)


atexit.register(_cleanup_ephemeral)


def create_cookie_file(cookies: list[dict]) -> Path:
    if not isinstance(cookies, list) or len(cookies) > MAX_COOKIES:
        raise HostError("Cookie handoff exceeds the safe limit")
    lines = ["# Netscape HTTP Cookie File", "# Temporary file created by One-Click Video Downloader", ""]
    for cookie in cookies:
        fields = [
            str(cookie.get("domain") or ""),
            "TRUE" if str(cookie.get("domain") or "").startswith(".") else "FALSE",
            str(cookie.get("path") or "/"),
            "TRUE" if cookie.get("secure") else "FALSE",
            str(max(0, int(cookie.get("expirationDate") or 0))),
            str(cookie.get("name") or ""),
            str(cookie.get("value") or ""),
        ]
        if not fields[0] or not fields[5] or any("\t" in field or "\r" in field or "\n" in field for field in fields):
            continue
        if cookie.get("httpOnly"):
            fields[0] = f"#HttpOnly_{fields[0]}"
        lines.append("\t".join(fields))
    handle = tempfile.NamedTemporaryFile(
        mode="w", suffix=".cookies.txt", prefix="ocvd-", encoding="utf-8", delete=False
    )
    with handle:
        handle.write("\n".join(lines) + "\n")
    path = Path(handle.name)
    path.chmod(0o600)
    _track_ephemeral(path)
    return path


def build_yt_dlp_command(
    python: str,
    ffmpeg: str,
    job: dict,
    output_template: Path,
    cookie_path: Path | None = None,
) -> list[str]:
    page_url = validated_url(job.get("pageUrl", ""))
    command = [
        python, "-m", "yt_dlp",
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--no-update",
        "--no-color",
        "--newline",
        "--socket-timeout", "30",
        "--retries", "3",
        "--fragment-retries", "3",
        "--retry-sleep", "1",
        "--ffmpeg-location", ffmpeg,
        "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "--recode-video", "mp4",
        "--output", str(output_template),
        "--progress-template", "download:OCVD_PROGRESS:%(progress._percent_str)s",
        "--print", "after_move:OCVD_OUTPUT:%(filepath)s",
    ]
    user_agent = str(job.get("userAgent") or "")
    if user_agent:
        if "\r" in user_agent or "\n" in user_agent:
            raise HostError("Invalid browser user agent")
        command.extend(["--user-agent", user_agent])
    if cookie_path:
        command.extend(["--cookies", str(cookie_path)])
    command.extend(["--", page_url])
    return command


def run_yt_dlp(
    command: list[str],
    controller: ProcessController,
    on_progress: Callable[[float | None, str], None],
    on_retry: Callable[[], None],
) -> tuple[int, str, Path | None]:
    output_path: Path | None = None
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as error_stream:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=error_stream,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            **_popen_group_arguments(),
        )
        controller.attach(process)
        try:
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.strip()
                if line.startswith("OCVD_OUTPUT:"):
                    output_path = Path(line.removeprefix("OCVD_OUTPUT:"))
                elif line.startswith("OCVD_PROGRESS:"):
                    match = re.search(r"([0-9]+(?:\.[0-9]+)?)%", line)
                    on_progress(float(match.group(1)) if match else None, "Downloading with local yt-dlp")
                elif "retry" in line.lower():
                    on_retry()
            process.stdout.close()
            return_code = process.wait()
        finally:
            controller.detach(process)
        error_stream.seek(0)
        stderr = error_stream.read()
    return return_code, stderr.strip(), output_path


def cleanup_yt_dlp_outputs(final_output: Path) -> None:
    prefix = f"{final_output.stem}.part."
    for path in final_output.parent.iterdir():
        if path.name.startswith(prefix) and path.is_file():
            path.unlink(missing_ok=True)


def execute_yt_dlp_job(
    message: dict,
    send: Callable[[dict], None],
    controller: ProcessController,
    capabilities: dict,
) -> None:
    message_id = str(message.get("id") or "")
    job = message.get("job") or {}
    if not capabilities["ytDlp"]["available"]:
        raise HostError("yt-dlp fallback is not installed in the production .venv")
    final_output = unique_output_path(download_directory(), job.get("title") or "video")
    output_template = final_output.with_name(f"{final_output.stem}.part.%(ext)s")
    cookie_path: Path | None = None
    if job.get("cookies"):
        cookie_path = create_cookie_file(job["cookies"])
    send({"id": message_id, "event": "started", "live": False, "detail": "Local yt-dlp started"})
    try:
        command = build_yt_dlp_command(
            sys.executable,
            capabilities["ffmpeg"]["path"],
            job,
            output_template,
            cookie_path,
        )
        retry_count = 0

        def report(progress: float | None, detail: str) -> None:
            send({"id": message_id, "event": "progress", "progress": progress, "detail": detail})

        def report_retry() -> None:
            nonlocal retry_count
            retry_count += 1
            send({
                "id": message_id,
                "event": "retrying",
                "attempt": retry_count,
                "detail": "yt-dlp is retrying a temporary download failure",
            })

        return_code, stderr, downloaded = run_yt_dlp(command, controller, report, report_retry)
        if controller.intent:
            cleanup_yt_dlp_outputs(final_output)
            send({"id": message_id, "event": "canceled"})
            return
        if return_code != 0:
            cleanup_yt_dlp_outputs(final_output)
            raise HostError(safe_error(stderr) or f"yt-dlp exited with status {return_code}")
        if not downloaded:
            matches = [path for path in final_output.parent.iterdir() if path.name.startswith(f"{final_output.stem}.part.")]
            downloaded = matches[0] if len(matches) == 1 else None
        if not downloaded:
            raise HostError("yt-dlp completed without reporting an output file")
        downloaded = downloaded.resolve()
        if downloaded.parent != final_output.parent.resolve() or not downloaded.name.startswith(f"{final_output.stem}.part."):
            raise HostError("yt-dlp reported an unexpected output path")
        if downloaded.suffix.lower() != ".mp4" or not valid_output(capabilities["ffprobe"]["path"], downloaded):
            cleanup_yt_dlp_outputs(final_output)
            raise HostError("yt-dlp did not produce a valid MP4 video")
        downloaded.replace(final_output)
        send({"id": message_id, "event": "complete", "output": str(final_output), "progress": 100})
    finally:
        if cookie_path:
            _remove_ephemeral(cookie_path)


def _ffmpeg_detail(codec_plan: dict, live: bool) -> str:
    if live:
        return "Recording live stream locally"
    if codec_plan.get("transcoding"):
        pieces = []
        if codec_plan.get("video") != "copy":
            pieces.append("video")
        if codec_plan.get("audio") != "copy" and codec_plan.get("has_audio") is not False:
            pieces.append("audio")
        return f"Transcoding {' and '.join(pieces)} locally"
    return "Remuxing with local FFmpeg"


def execute_job(
    message: dict,
    send: Callable[[dict], None],
    controller: ProcessController | None = None,
) -> None:
    message_id = str(message.get("id") or "")
    job = message.get("job") or {}
    controller = controller or ProcessController(message_id or "synchronous")
    capabilities = dependency_capabilities()
    if job.get("kind") == "page":
        execute_yt_dlp_job(message, send, controller, capabilities)
        return

    ffmpeg = capabilities["ffmpeg"]["path"]
    ffprobe = capabilities["ffprobe"]["path"]
    final_output = unique_output_path(download_directory(), job.get("title") or "video")
    temporary_output = final_output.with_name(f"{final_output.stem}.part.mp4")

    with prepared_job_inputs(job) as prepared_job:
        inputs = prepared_job.get("inputs") or []
        metadata = [probe_media(ffprobe, media_input) for media_input in inputs[:2]]
        duration = metadata_duration(metadata[0]) if metadata else None
        live = bool(job.get("live")) or (prepared_job.get("kind") == "manifest" and duration is None)
        controller.live = live
        plan = codec_strategy(prepared_job.get("kind", ""), metadata)
        if plan["video"] == "libx264" and not capabilities["encoders"]["libx264"]:
            raise HostError("This video requires the libx264 FFmpeg encoder, but it is unavailable")
        if plan["audio"] == "aac" and not capabilities["encoders"]["aac"]:
            raise HostError("This audio requires the AAC FFmpeg encoder, but it is unavailable")

        send({
            "id": message_id,
            "event": "started",
            "live": live,
            "detail": "Recording live" if live else _ffmpeg_detail(plan, live),
        })
        if controller.intent:
            send({"id": message_id, "event": "canceled"})
            return

        def report(progress: float | None, detail: str) -> None:
            send({"id": message_id, "event": "progress", "progress": progress, "detail": detail})

        def run_attempts(codec: dict, *, full_transcode: bool = False) -> tuple[int, str]:
            return_code = 1
            stderr = ""
            detail = "Transcoding video and audio locally" if full_transcode else _ffmpeg_detail(codec, live)
            for attempt in range(1, HTTP_RETRY_ATTEMPTS + 1):
                command = build_ffmpeg_command(
                    ffmpeg,
                    prepared_job,
                    temporary_output,
                    codec_plan=codec,
                    transcode=full_transcode,
                    live=live,
                )
                return_code, stderr = run_ffmpeg(command, duration, report, controller, detail)
                if return_code == 0 or controller.intent:
                    break
                if attempt >= HTTP_RETRY_ATTEMPTS or not is_transient_failure(stderr):
                    break
                temporary_output.unlink(missing_ok=True)
                send({
                    "id": message_id,
                    "event": "retrying",
                    "attempt": attempt + 1,
                    "maxAttempts": HTTP_RETRY_ATTEMPTS,
                    "detail": "Temporary network failure; retrying locally",
                })
                if not controller.wait_delay(2 ** (attempt - 1)):
                    break
            return return_code, stderr

        return_code, stderr = run_attempts(plan)
        if not controller.intent and return_code != 0 and should_retry_with_transcode(stderr) and not (
            plan["video"] == "libx264" and plan["audio"] == "aac"
        ):
            temporary_output.unlink(missing_ok=True)
            report(None, "Selective remux failed; transcoding video and audio locally")
            return_code, stderr = run_attempts(plan, full_transcode=True)

        expect_audio = plan.get("has_audio") is True or prepared_job.get("kind") == "merge"
        if controller.intent == "cancel":
            temporary_output.unlink(missing_ok=True)
            send({"id": message_id, "event": "canceled"})
            return
        if controller.intent == "stop":
            if valid_output(ffprobe, temporary_output, expect_audio=expect_audio):
                temporary_output.replace(final_output)
                send({
                    "id": message_id,
                    "event": "complete",
                    "output": str(final_output),
                    "progress": 100,
                    "stopped": True,
                })
                return
            temporary_output.unlink(missing_ok=True)
            raise HostError("The stopped recording could not be finalized as a playable MP4")
        if return_code != 0 or not valid_output(ffprobe, temporary_output, expect_audio=expect_audio):
            temporary_output.unlink(missing_ok=True)
            raise HostError(safe_error(stderr) or f"FFmpeg exited with status {return_code}")

        temporary_output.replace(final_output)
        send({"id": message_id, "event": "complete", "output": str(final_output), "progress": 100})


class JobRegistry:
    def __init__(self, send: Callable[[dict], None]):
        self.send = send
        self._jobs: dict[str, tuple[ProcessController, threading.Thread]] = {}
        self._lock = threading.Lock()

    def start(self, message: dict) -> None:
        job_id = str(message.get("id") or "")
        if not job_id:
            raise HostError("A job ID is required")
        with self._lock:
            if job_id in self._jobs:
                raise HostError("A job with this ID is already active")
            if self._jobs:
                raise HostError("Another native media job is already active")
            controller = ProcessController(job_id)
            thread = threading.Thread(
                target=self._worker,
                args=(message, controller),
                name=f"ocvd-{job_id[:8]}",
                daemon=True,
            )
            self._jobs[job_id] = (controller, thread)
        thread.start()

    def _worker(self, message: dict, controller: ProcessController) -> None:
        job_id = controller.job_id
        try:
            execute_job(message, self.send, controller)
        except Exception as error:
            print(f"{HOST_NAME}: {error}", file=sys.stderr, flush=True)
            if controller.intent == "cancel":
                self.send({"id": job_id, "event": "canceled"})
            else:
                self.send({"id": job_id, "event": "error", "error": safe_error(str(error))})
        finally:
            with self._lock:
                self._jobs.pop(job_id, None)

    def control(self, job_id: str, action: str) -> None:
        with self._lock:
            entry = self._jobs.get(job_id)
        if not entry:
            raise HostError("The requested job is not active")
        controller, _thread = entry
        controller.request(action)
        self.send({
            "id": job_id,
            "event": "stopping",
            "action": action,
            "detail": "Stopping and finalizing" if action == "stop" else "Canceling download",
        })

    def shutdown(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for controller, _thread in jobs:
            controller.request("cancel")
        for _controller, thread in jobs:
            thread.join(timeout=GRACEFUL_STOP_SECONDS + 1)


def main() -> int:
    input_stream = sys.stdin.buffer
    output_stream = sys.stdout.buffer
    write_lock = threading.Lock()

    def send(message: dict) -> None:
        with write_lock:
            write_message(output_stream, message)

    registry = JobRegistry(send)

    def terminate_host(signum, _frame) -> None:
        registry.shutdown()
        _cleanup_ephemeral()
        raise SystemExit(128 + signum)

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, terminate_host)
    try:
        while True:
            message_id = ""
            try:
                message = read_message(input_stream)
                if message is None:
                    return 0
                message_id = str(message.get("id") or "")
                action = message.get("action")
                if action == "ping":
                    capabilities = dependency_capabilities()
                    send({
                        "id": message_id,
                        "event": "ready",
                        "ffmpeg": capabilities["ffmpeg"]["version"],
                        "ffprobe": capabilities["ffprobe"]["version"],
                        "capabilities": capabilities,
                    })
                elif action == "download":
                    registry.start(message)
                elif action in {"cancel", "stop"}:
                    registry.control(message_id, action)
                else:
                    raise HostError("Unsupported native host action")
            except Exception as error:  # Protocol boundary: always return a structured error.
                print(f"{HOST_NAME}: {error}", file=sys.stderr, flush=True)
                send({"id": message_id, "event": "error", "error": safe_error(str(error))})
    finally:
        registry.shutdown()
        _cleanup_ephemeral()


if __name__ == "__main__":
    raise SystemExit(main())
