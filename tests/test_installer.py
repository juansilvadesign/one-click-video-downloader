from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[1]
INSTALLER_PATH = PROJECT_ROOT / "native-host" / "install_host.py"
SPEC = importlib.util.spec_from_file_location("install_host", INSTALLER_PATH)
installer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_validates_chrome_extension_ids(self):
        extension_id = "a" * 32
        self.assertEqual(installer.validate_extension_id(extension_id), extension_id)
        with self.assertRaises(argparse.ArgumentTypeError):
            installer.validate_extension_id("not-an-extension-id")

    def test_manifest_is_restricted_to_selected_extension(self):
        payload = installer.manifest_payload("a" * 32, Path("/tmp/host-launcher"))
        self.assertEqual(payload["name"], installer.HOST_NAME)
        self.assertEqual(payload["allowed_origins"], [f"chrome-extension://{'a' * 32}/"])

    def test_production_interpreter_lives_in_dot_venv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(installer.production_python(root, "Linux"), root / ".venv/bin/python")
            self.assertEqual(installer.production_python(root, "Windows"), root / ".venv/Scripts/python.exe")

    def test_optional_extractor_installs_through_production_venv(self):
        production_python = Path("/local/app/.venv/bin/python")
        with mock.patch.object(installer.subprocess, "run") as run:
            installer.install_optional_yt_dlp(production_python)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0][:3], [str(production_python), "-m", "ensurepip"])
        pip_command = run.call_args_list[1].args[0]
        self.assertEqual(pip_command[:4], [str(production_python), "-m", "pip", "install"])
        self.assertIn("requirements-yt-dlp.txt", pip_command[-1])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
    def test_installed_production_venv_launches_host_and_reports_capabilities(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "installed"
            manifest = Path(directory) / "manifest" / "host.json"
            with mock.patch.object(installer, "installation_root", return_value=root), \
                    mock.patch.object(installer, "manifest_locations", return_value=[manifest]):
                installer.install("a" * 32, "chrome")

            payload = json.loads(manifest.read_text(encoding="utf-8"))
            launcher = Path(payload["path"])
            self.assertTrue(installer.production_python(root, "Linux").exists())
            process = subprocess.Popen(
                [str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            request = json.dumps({"action": "ping", "id": "installer-smoke"}).encode("utf-8")
            assert process.stdin is not None
            process.stdin.write(struct.pack("=I", len(request)) + request)
            process.stdin.flush()
            assert process.stdout is not None
            (length,) = struct.unpack("=I", process.stdout.read(4))
            response = json.loads(process.stdout.read(length).decode("utf-8"))
            process.stdin.close()
            process.wait(timeout=10)
            process.stdout.close()
            assert process.stderr is not None
            process.stderr.close()
            self.assertEqual(response["event"], "ready")
            self.assertIn("ffprobe", response["capabilities"])


if __name__ == "__main__":
    unittest.main()
