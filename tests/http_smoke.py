"""Optional localhost smoke test for the complete Native Messaging FFmpeg job."""

from __future__ import annotations

import importlib.util
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
    def log_message(self, _format, *_args):
        return


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
                            {"url": f"{base_url}/video.mp4", "headers": {}},
                            {"url": f"{base_url}/audio.m4a", "headers": {}},
                        ],
                    },
                },
                messages.append,
            )
        finally:
            server.shutdown()
            server.server_close()

        completed = next(message for message in messages if message.get("event") == "complete")
        result = Path(completed["output"])
        if not result.exists() or result.stat().st_size == 0:
            raise RuntimeError("Native host did not produce a non-empty MP4")
        print(f"HTTP native-host smoke test passed: {result.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

