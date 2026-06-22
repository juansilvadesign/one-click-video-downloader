"""Optional localhost smoke test for the complete Native Messaging FFmpeg job."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = PROJECT_ROOT / "native-host" / "one_click_video_host.py"
SPEC = importlib.util.spec_from_file_location("one_click_video_host", HOST_PATH)
host = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(host)


class QuietHandler(SimpleHTTPRequestHandler):
    retry_failures = 0

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path == "/retry-video.mp4" and type(self).retry_failures == 0:
            type(self).retry_failures += 1
            self.send_error(503, "Injected temporary failure")
            return
        if self.path == "/retry-video.mp4":
            self.path = "/video.mp4"
        super().do_GET()


def create_fixtures(root: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required")
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1",
            "-an", "-c:v", "mpeg4", str(root / "video.mp4"),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=orange:s=160x90:d=1",
            "-f", "lavfi", "-i", "sine=frequency=520:duration=1",
            "-c:v", "libx264", "-c:a", "libopus", "-shortest",
            str(root / "selective-audio.mkv"),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=yellow:s=160x90:d=1",
            "-f", "lavfi", "-i", "sine=frequency=740:duration=1",
            "-c:v", "libvpx-vp9", "-c:a", "aac", "-shortest",
            str(root / "selective-video.mkv"),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=purple:s=160x90:d=1.5",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
            "-c:v", "libx264", "-c:a", "aac", "-f", "hls",
            "-hls_time", "0.4", "-hls_list_size", "0",
            "-hls_segment_filename", str(root / "segment-%03d.ts"),
            str(root / "stream.m3u8"),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
            "-vn", "-c:a", "aac", str(root / "audio.m4a"),
        ],
        check=True,
    )


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        output = root / "downloads"
        create_fixtures(root)
        os.environ["ONE_CLICK_VIDEO_DOWNLOAD_DIR"] = str(output)

        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            partial(QuietHandler, directory=str(root)),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        messages: list[dict] = []
        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            host.execute_job(
                {
                    "id": "http-smoke",
                    "job": {
                        "kind": "merge",
                        "title": "HTTP smoke test",
                        "inputs": [
                            {"url": f"{base_url}/retry-video.mp4", "headers": {}},
                            {"url": f"{base_url}/audio.m4a", "headers": {}},
                        ],
                    },
                },
                messages.append,
            )
            for title, filename in (
                ("Selective audio smoke", "selective-audio.mkv"),
                ("Selective video smoke", "selective-video.mkv"),
            ):
                host.execute_job(
                    {
                        "id": filename,
                        "job": {
                            "kind": "direct",
                            "title": title,
                            "inputs": [{"url": f"{base_url}/{filename}", "headers": {}}],
                        },
                    },
                    messages.append,
                )
            host.execute_job(
                {
                    "id": "inline-hls-smoke",
                    "job": {
                        "kind": "manifest",
                        "title": "Inline HLS smoke test",
                        "inputs": [{
                            "manifestText": (root / "stream.m3u8").read_text(encoding="utf-8"),
                            "baseUrl": f"{base_url}/stream.m3u8",
                            "headers": {},
                        }],
                    },
                },
                messages.append,
            )
        finally:
            server.shutdown()
            server.server_close()

        completed = [message for message in messages if message.get("event") == "complete"]
        if len(completed) != 4:
            raise RuntimeError(f"Expected four completed jobs, received {len(completed)}")
        for message in completed:
            result = Path(message["output"])
            if not result.exists() or result.stat().st_size == 0:
                raise RuntimeError("Native host did not produce a non-empty MP4")
            if result.stem.startswith("Selective"):
                probe = subprocess.run(
                    [
                        shutil.which("ffprobe"), "-v", "error", "-show_entries",
                        "stream=codec_type,codec_name", "-of", "json", str(result),
                    ],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                codecs = {
                    stream["codec_type"]: stream["codec_name"]
                    for stream in json.loads(probe.stdout)["streams"]
                }
                if codecs != {"video": "h264", "audio": "aac"}:
                    raise RuntimeError(f"Selective transcode produced unexpected codecs: {codecs}")
        if QuietHandler.retry_failures != 1:
            raise RuntimeError("Injected HTTP retry fixture was not exercised")
        print("HTTP retry, inline-HLS, and selective-codec native-host smoke tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
