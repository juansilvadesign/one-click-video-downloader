from __future__ import annotations

import importlib.util
import io
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = PROJECT_ROOT / "native-host" / "one_click_video_host.py"
SPEC = importlib.util.spec_from_file_location("one_click_video_host", HOST_PATH)
host = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(host)


class NativeHostUnitTests(unittest.TestCase):
    def test_native_message_round_trip(self):
        stream = io.BytesIO()
        host.write_message(stream, {"action": "ping", "title": "Vídeo"})
        stream.seek(0)
        self.assertEqual(host.read_message(stream), {"action": "ping", "title": "Vídeo"})

    def test_header_allowlist_and_newline_rejection(self):
        block = host.ffmpeg_header_block({
            "referer": "https://example.test/page",
            "cookie": "session=abc",
            "x-ignore": "no",
        })
        self.assertIn("Referer: https://example.test/page", block)
        self.assertIn("Cookie: session=abc", block)
        self.assertNotIn("x-ignore", block.lower())
        with self.assertRaises(host.HostError):
            host.ffmpeg_header_block({"referer": "ok\r\nInjected: value"})

    def test_merge_command_uses_argument_array_and_explicit_maps(self):
        command = host.build_ffmpeg_command(
            "/usr/bin/ffmpeg",
            {
                "kind": "merge",
                "inputs": [
                    {"url": "https://example.test/video.mp4", "headers": {}},
                    {"url": "https://example.test/audio.m4a", "headers": {}},
                ],
            },
            Path("output.part.mp4"),
        )
        self.assertEqual(command[0], "/usr/bin/ffmpeg")
        self.assertIn("0:v:0", command)
        self.assertIn("1:a:0", command)
        self.assertEqual(command[-1], "output.part.mp4")

    def test_rejects_non_http_inputs(self):
        with self.assertRaises(host.HostError):
            host.input_arguments({"url": "file:///etc/passwd"})

    def test_sanitizes_filename(self):
        self.assertEqual(host.sanitize_filename(' Lesson: 01 / Intro? '), "Lesson 01 Intro")

    def test_redacts_media_urls_from_ffmpeg_errors(self):
        error = host.safe_error("failed to open https://example.test/video.m3u8?token=secret")
        self.assertNotIn("secret", error)
        self.assertIn("[media URL]", error)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
class NativeHostIntegrationTests(unittest.TestCase):
    def test_ffmpeg_runner_merges_video_and_audio_into_mp4(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            video = root / "video.mp4"
            audio = root / "audio.m4a"
            output = root / "merged.part.mp4"

            subprocess.run(
                [
                    shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1",
                    "-an", "-c:v", "mpeg4", str(video),
                ],
                check=True,
            )
            subprocess.run(
                [
                    shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
                    "-vn", "-c:a", "aac", str(audio),
                ],
                check=True,
            )

            command = [
                shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-progress", "pipe:1", "-nostats",
                "-i", str(video), "-i", str(audio),
                "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
                "-movflags", "+faststart", str(output),
            ]
            updates = []
            return_code, stderr = host.run_ffmpeg(
                command,
                1.0,
                lambda progress, detail: updates.append((progress, detail)),
            )

            self.assertEqual(return_code, 0, stderr)
            self.assertTrue(output.exists())
            probe = subprocess.run(
                [
                    shutil.which("ffprobe"), "-v", "error", "-show_entries", "stream=codec_type",
                    "-of", "json", str(output),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            stream_types = {stream["codec_type"] for stream in json.loads(probe.stdout)["streams"]}
            self.assertEqual(stream_types, {"video", "audio"})
            self.assertTrue(updates)


if __name__ == "__main__":
    unittest.main()
