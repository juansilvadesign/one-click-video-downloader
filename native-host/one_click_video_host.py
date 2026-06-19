#!/usr/bin/env python3
"""Native Messaging host that downloads and muxes media with local FFmpeg."""

from __future__ import annotations

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import BinaryIO, Callable

HOST_NAME = "io.local.one_click_video_downloader"
MAX_INCOMING_MESSAGE = 64 * 1024 * 1024
ALLOWED_HEADERS = {"authorization", "cookie", "origin", "referer", "user-agent"}


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
    while candidate.exists() or candidate.with_name(f"{candidate.stem}.part.mp4").exists():
        candidate = directory / f"{stem} ({counter}).mp4"
        counter += 1
    return candidate


def validated_url(value: str) -> str:
    if not isinstance(value, str) or not re.match(r"^https?://", value, re.IGNORECASE):
        raise HostError("Only HTTP(S) media URLs are accepted")
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


def input_arguments(media_input: dict) -> list[str]:
    url = validated_url(media_input.get("url", ""))
    headers = ffmpeg_header_block(media_input.get("headers"))
    arguments: list[str] = []
    if headers:
        arguments.extend(["-headers", headers])
    arguments.extend(["-i", url])
    return arguments


def build_ffmpeg_command(
    ffmpeg: str,
    job: dict,
    temporary_output: Path,
    *,
    transcode: bool = False,
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
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    for media_input in inputs[:2] if kind == "merge" else inputs[:1]:
        command.extend(input_arguments(media_input))

    if kind == "merge":
        command.extend(["-map", "0:v:0", "-map", "1:a:0"])

    if transcode:
        command.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"])
    else:
        command.extend(["-c", "copy"])
    command.extend(["-movflags", "+faststart", str(temporary_output)])
    return command


def probe_duration(ffprobe: str, media_input: dict) -> float | None:
    command = [ffprobe, "-v", "error"]
    command.extend(input_arguments(media_input))
    command.extend(["-show_entries", "format=duration", "-of", "default=nw=1:nk=1"])
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
        duration = float(result.stdout.strip())
        return duration if duration > 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


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


def run_ffmpeg(
    command: list[str],
    duration: float | None,
    on_progress: Callable[[float | None, str], None],
) -> tuple[int, str]:
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as error_stream:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=error_stream,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
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
                on_progress(percentage, "Merging with local FFmpeg")
                progress_values.clear()
        process.stdout.close()
        return_code = process.wait()
        error_stream.seek(0)
        stderr = error_stream.read()
    return return_code, stderr.strip()


def safe_error(value: str) -> str:
    redacted = re.sub(r"https?://[^\s\]]+", "[media URL]", str(value), flags=re.IGNORECASE)
    return redacted[:2_000]


def ffmpeg_version(ffmpeg: str) -> str:
    result = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, timeout=5, check=False)
    match = re.search(r"ffmpeg version\s+([^\s]+)", result.stdout)
    return match.group(1) if match else "available"


def execute_job(message: dict, send: Callable[[dict], None]) -> None:
    message_id = str(message.get("id") or "")
    job = message.get("job") or {}
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise HostError("FFmpeg and ffprobe must both be available on PATH")

    final_output = unique_output_path(download_directory(), job.get("title") or "video")
    temporary_output = final_output.with_name(f"{final_output.stem}.part.mp4")
    duration = probe_duration(ffprobe, (job.get("inputs") or [{}])[0])

    send({"id": message_id, "event": "started", "detail": "Local FFmpeg started"})

    def report(progress: float | None, detail: str) -> None:
        send({"id": message_id, "event": "progress", "progress": progress, "detail": detail})

    command = build_ffmpeg_command(ffmpeg, job, temporary_output)
    return_code, stderr = run_ffmpeg(command, duration, report)
    if return_code != 0 and should_retry_with_transcode(stderr):
        temporary_output.unlink(missing_ok=True)
        report(None, "Remux was incompatible; transcoding locally")
        command = build_ffmpeg_command(ffmpeg, job, temporary_output, transcode=True)
        return_code, stderr = run_ffmpeg(command, duration, report)

    if return_code != 0 or not temporary_output.exists():
        temporary_output.unlink(missing_ok=True)
        raise HostError(safe_error(stderr) or f"FFmpeg exited with status {return_code}")

    temporary_output.replace(final_output)
    send({"id": message_id, "event": "complete", "output": str(final_output), "progress": 100})


def main() -> int:
    input_stream = sys.stdin.buffer
    output_stream = sys.stdout.buffer

    def send(message: dict) -> None:
        write_message(output_stream, message)

    while True:
        message_id = ""
        try:
            message = read_message(input_stream)
            if message is None:
                return 0
            message_id = str(message.get("id") or "")
            if message.get("action") == "ping":
                ffmpeg = shutil.which("ffmpeg")
                if not ffmpeg:
                    raise HostError("FFmpeg is not available on PATH")
                send({"id": message_id, "event": "ready", "ffmpeg": ffmpeg_version(ffmpeg)})
            elif message.get("action") == "download":
                execute_job(message, send)
            else:
                raise HostError("Unsupported native host action")
        except Exception as error:  # Protocol boundary: always return a structured error.
            print(f"{HOST_NAME}: {error}", file=sys.stderr, flush=True)
            send({"id": message_id, "event": "error", "error": safe_error(str(error))})


if __name__ == "__main__":
    raise SystemExit(main())
