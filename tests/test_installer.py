from __future__ import annotations

import argparse
import importlib.util
import tempfile
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()

