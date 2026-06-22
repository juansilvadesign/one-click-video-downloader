import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const python = resolve(
  process.cwd(),
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python"
);
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
  { stdio: "inherit" }
);

if (result.error) {
  console.error(`Unable to run the project .venv interpreter: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
