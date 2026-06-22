from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import signal
import struct
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


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

    def test_http_reconnect_is_bounded_and_live_eof_is_opt_in(self):
        finite = host.input_arguments({"url": "https://example.test/video.m3u8"})
        live = host.input_arguments({"url": "https://example.test/video.m3u8"}, live=True)
        self.assertIn("-rw_timeout", finite)
        self.assertIn("-reconnect_on_network_error", finite)
        self.assertNotIn("-reconnect_at_eof", finite)
        self.assertIn("-reconnect_at_eof", live)

    def test_codec_strategy_copies_and_transcodes_streams_independently(self):
        h264_aac = [{"streams": [
            {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "aac", "channels": 2},
        ]}]
        h264_opus = [{"streams": [
            {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "opus", "channels": 2},
        ]}]
        vp9_aac = [{"streams": [
            {"codec_type": "video", "codec_name": "vp9", "width": 1920, "height": 1080},
            {"codec_type": "audio", "codec_name": "aac", "channels": 2},
        ]}]
        self.assertEqual(host.codec_strategy("manifest", h264_aac)["video"], "copy")
        self.assertEqual(host.codec_strategy("manifest", h264_aac)["audio"], "copy")
        self.assertEqual(host.codec_strategy("manifest", h264_opus)["audio"], "aac")
        self.assertEqual(host.codec_strategy("manifest", vp9_aac)["video"], "libx264")
        self.assertEqual(host.codec_strategy("manifest", vp9_aac)["audio"], "copy")

    def test_selective_command_preserves_compatible_video(self):
        command = host.build_ffmpeg_command(
            "/usr/bin/ffmpeg",
            {"kind": "direct", "inputs": [{"url": "https://example.test/video.webm"}]},
            Path("output.part.mp4"),
            codec_plan={"video": "copy", "audio": "aac", "has_audio": True},
        )
        self.assertEqual(command[command.index("-c:v") + 1], "copy")
        self.assertEqual(command[command.index("-c:a") + 1], "aac")

    def test_rejects_non_http_inputs(self):
        with self.assertRaises(host.HostError):
            host.input_arguments({"url": "file:///etc/passwd"})
        with self.assertRaises(host.HostError):
            host.input_arguments({"url": "https:///missing-host"})
        with self.assertRaises(host.HostError):
            host.input_arguments({"url": "https://user:secret@example.test/video"})

    def test_sanitizes_filename(self):
        self.assertEqual(host.sanitize_filename(' Lesson: 01 / Intro? '), "Lesson 01 Intro")

    def test_unique_output_does_not_reuse_existing_partial_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Lesson.part.webm").write_bytes(b"existing")
            self.assertEqual(host.unique_output_path(root, "Lesson").name, "Lesson (1).mp4")

    def test_redacts_media_urls_from_ffmpeg_errors(self):
        error = host.safe_error("failed to open https://example.test/video.m3u8?token=secret")
        self.assertNotIn("secret", error)
        self.assertIn("[media URL]", error)

    def test_transient_failure_classifier_excludes_auth_and_malformed_inputs(self):
        self.assertTrue(host.is_transient_failure("Connection reset by peer"))
        self.assertTrue(host.is_transient_failure("Server returned 503 Service Unavailable"))
        self.assertFalse(host.is_transient_failure("Server returned 403 Forbidden"))
        self.assertFalse(host.is_transient_failure("Invalid data found when processing input"))

    def test_inline_hls_resolves_segments_and_keys(self):
        resolved = host.resolve_hls_manifest(
            '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\nsegments/one.ts\n',
            "https://media.example/course/master.m3u8",
        )
        self.assertIn('URI="https://media.example/course/keys/key.bin"', resolved)
        self.assertIn("https://media.example/course/segments/one.ts", resolved)
        with self.assertRaises(host.HostError):
            host.resolve_hls_manifest("not hls", "https://media.example/page")

    def test_cookie_file_is_private_and_removed(self):
        path = host.create_cookie_file([{
            "domain": ".example.test",
            "path": "/",
            "secure": True,
            "httpOnly": True,
            "expirationDate": 2_000_000_000,
            "name": "session",
            "value": "private",
        }])
        try:
            self.assertTrue(path.exists())
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn("#HttpOnly_.example.test", path.read_text(encoding="utf-8"))
        finally:
            host._remove_ephemeral(path)
        self.assertFalse(path.exists())

    def test_yt_dlp_command_is_pinned_to_safe_runtime_behavior(self):
        command = host.build_yt_dlp_command(
            "/production/.venv/bin/python",
            "/usr/bin/ffmpeg",
            {"pageUrl": "https://example.test/watch/1", "userAgent": "Chrome test"},
            Path("video.part.%(ext)s"),
            Path("cookies.txt"),
        )
        self.assertEqual(command[:3], ["/production/.venv/bin/python", "-m", "yt_dlp"])
        self.assertIn("--no-playlist", command)
        self.assertIn("--no-plugin-dirs", command)
        self.assertIn("--ignore-config", command)
        self.assertIn("--cookies", command)
        self.assertEqual(command[-1], "https://example.test/watch/1")

    def test_dependency_preflight_requires_ffprobe(self):
        with mock.patch.object(host.shutil, "which", side_effect=lambda name: "/ffmpeg" if name == "ffmpeg" else None):
            with self.assertRaisesRegex(host.HostError, "ffprobe"):
                host.dependency_capabilities()

    def test_registry_accepts_cancel_while_worker_is_active(self):
        entered = threading.Event()
        finished = threading.Event()
        messages = []

        def fake_execute(_message, _send, controller):
            entered.set()
            while not controller.intent:
                time.sleep(0.005)
            finished.set()

        registry = host.JobRegistry(messages.append)
        with mock.patch.object(host, "execute_job", side_effect=fake_execute):
            registry.start({"id": "active-job", "job": {}})
            self.assertTrue(entered.wait(1))
            registry.control("active-job", "cancel")
            self.assertTrue(finished.wait(1))
        self.assertTrue(any(message.get("event") == "stopping" for message in messages))

    def test_registry_controls_each_concurrent_job_independently(self):
        entered = []
        finished = set()
        lock = threading.Lock()

        def fake_execute(message, _send, controller):
            with lock:
                entered.append(message["id"])
            while not controller.intent:
                time.sleep(0.005)
            with lock:
                finished.add(message["id"])

        def wait_until(predicate):
            for _ in range(400):
                if predicate():
                    return True
                time.sleep(0.005)
            return False

        registry = host.JobRegistry(lambda _message: None)
        with mock.patch.object(host, "execute_job", side_effect=fake_execute):
            registry.start({"id": "job-a", "job": {}})
            registry.start({"id": "job-b", "job": {}})
            self.assertTrue(wait_until(lambda: set(entered) == {"job-a", "job-b"}))
            registry.control("job-a", "cancel")
            self.assertTrue(wait_until(lambda: "job-a" in finished))
            self.assertEqual(finished, {"job-a"})  # job-b keeps running independently
            registry.control("job-b", "cancel")
            registry.shutdown()
        self.assertEqual(finished, {"job-a", "job-b"})

    def test_registry_rejects_jobs_beyond_the_concurrency_cap(self):
        entered = []
        release = threading.Event()
        lock = threading.Lock()

        def fake_execute(message, _send, controller):
            with lock:
                entered.append(message["id"])
            while not controller.intent and not release.is_set():
                time.sleep(0.005)

        registry = host.JobRegistry(lambda _message: None)
        with mock.patch.object(host, "execute_job", side_effect=fake_execute):
            try:
                for index in range(host.MAX_CONCURRENT_JOBS):
                    registry.start({"id": f"job-{index}", "job": {}})
                for _ in range(400):
                    if len(entered) == host.MAX_CONCURRENT_JOBS:
                        break
                    time.sleep(0.005)
                self.assertEqual(len(entered), host.MAX_CONCURRENT_JOBS)
                with self.assertRaisesRegex(host.HostError, "concurrent"):
                    registry.start({"id": "job-overflow", "job": {}})
            finally:
                release.set()
                registry.shutdown()
        self.assertEqual(len(entered), host.MAX_CONCURRENT_JOBS)

    def test_reserve_output_path_avoids_concurrent_name_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_path, first_release = host.reserve_output_path(root, "Showcase Video")
            second_path, second_release = host.reserve_output_path(root, "Showcase Video")
            self.assertEqual(first_path.name, "Showcase Video.mp4")
            self.assertEqual(second_path.name, "Showcase Video (1).mp4")
            first_release()
            # Released and nothing written to disk -> the name frees up again.
            third_path, third_release = host.reserve_output_path(root, "Showcase Video")
            self.assertEqual(third_path.name, "Showcase Video.mp4")
            second_release()
            third_release()

    def test_force_termination_fallback_has_windows_and_posix_paths(self):
        class FakeProcess:
            pid = 42

            def __init__(self):
                self.killed = False

            def wait(self, timeout):
                raise subprocess.TimeoutExpired("fake", timeout)

            def poll(self):
                return None

            def kill(self):
                self.killed = True

        windows_process = FakeProcess()
        windows_controller = host.ProcessController("windows")
        windows_controller._process = windows_process
        with mock.patch.object(host.os, "name", "nt"):
            windows_controller._force_after_timeout(windows_process)
        self.assertTrue(windows_process.killed)
        self.assertTrue(windows_controller.forced)

        posix_process = FakeProcess()
        posix_controller = host.ProcessController("posix")
        posix_controller._process = posix_process
        with mock.patch.object(host.os, "name", "posix"), \
                mock.patch.object(host.os, "getpgid", return_value=42), \
                mock.patch.object(host.os, "killpg") as killpg:
            posix_controller._force_after_timeout(posix_process)
        killpg.assert_called_once_with(42, signal.SIGKILL)

    def test_whole_job_retry_is_bounded_and_visible(self):
        capabilities = {
            "ffmpeg": {"path": "/ffmpeg", "version": "test"},
            "ffprobe": {"path": "/ffprobe", "version": "test"},
            "encoders": {"libx264": True, "aac": True},
            "ytDlp": {"available": False, "version": None},
        }
        metadata = {
            "format": {"duration": "1"},
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 320, "height": 180},
                {"codec_type": "audio", "codec_name": "aac", "channels": 2},
            ],
        }
        messages = []
        attempts = []

        def fake_run(command, _duration, _report, _controller, _detail):
            attempts.append(command)
            if len(attempts) < host.HTTP_RETRY_ATTEMPTS:
                return 1, "Connection reset by peer"
            Path(command[-1]).write_bytes(b"validated")
            return 0, ""

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(host, "dependency_capabilities", return_value=capabilities), \
                mock.patch.object(host, "download_directory", return_value=Path(directory)), \
                mock.patch.object(host, "probe_media", return_value=metadata), \
                mock.patch.object(host, "run_ffmpeg", side_effect=fake_run), \
                mock.patch.object(host, "valid_output", return_value=True), \
                mock.patch.object(host.ProcessController, "wait_delay", return_value=True):
            host.execute_job({
                "id": "retry-job",
                "job": {
                    "kind": "direct",
                    "title": "retry",
                    "inputs": [{"url": "https://example.test/video.mp4"}],
                },
            }, messages.append)
        self.assertEqual(len(attempts), host.HTTP_RETRY_ATTEMPTS)
        self.assertEqual([message["attempt"] for message in messages if message.get("event") == "retrying"], [2, 3])
        self.assertEqual(messages[-1]["event"], "complete")

    def test_cancel_removes_partial_vod_output(self):
        capabilities = {
            "ffmpeg": {"path": "/ffmpeg", "version": "test"},
            "ffprobe": {"path": "/ffprobe", "version": "test"},
            "encoders": {"libx264": True, "aac": True},
            "ytDlp": {"available": False, "version": None},
        }
        metadata = {
            "format": {"duration": "5"},
            "streams": [{"codec_type": "video", "codec_name": "h264", "width": 320, "height": 180}],
        }
        messages = []
        controller = host.ProcessController("cancel-vod")

        def fake_run(command, *_args):
            Path(command[-1]).write_bytes(b"partial")
            controller.request("cancel")
            return 255, "Interrupted"

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(host, "dependency_capabilities", return_value=capabilities), \
                mock.patch.object(host, "download_directory", return_value=Path(directory)), \
                mock.patch.object(host, "probe_media", return_value=metadata), \
                mock.patch.object(host, "run_ffmpeg", side_effect=fake_run):
            host.execute_job({
                "id": "cancel-vod",
                "job": {
                    "kind": "direct",
                    "title": "cancel",
                    "inputs": [{"url": "https://example.test/video.mp4"}],
                },
            }, messages.append, controller)
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertEqual(messages[-1]["event"], "canceled")


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

    def test_graceful_stop_finalizes_playable_video_and_audio(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "live.part.mp4"
            controller = host.ProcessController("live-stop")
            command = [
                shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-progress", "pipe:1", "-nostats",
                "-re", "-f", "lavfi", "-i", "color=c=green:s=160x90:r=24",
                "-re", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
                "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                "-t", "20", "-movflags", "+faststart", str(output),
            ]
            result = {}

            def worker():
                result["value"] = host.run_ffmpeg(command, None, lambda *_args: None, controller, "Recording")

            thread = threading.Thread(target=worker)
            thread.start()
            deadline = time.time() + 5
            while time.time() < deadline and controller._process is None:
                time.sleep(0.01)
            self.assertIsNotNone(controller._process)
            time.sleep(1.0)
            controller.request("stop")
            thread.join(timeout=host.GRACEFUL_STOP_SECONDS + 5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(controller.intent, "stop")
            self.assertFalse(controller.forced)
            self.assertTrue(host.valid_output(shutil.which("ffprobe"), output, expect_audio=True), result.get("value"))


if __name__ == "__main__":
    unittest.main()
