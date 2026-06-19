import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Manifest V3 references local files and required capabilities", async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("downloads"));

  const referencedFiles = [manifest.background.service_worker, manifest.action.default_popup];
  for (const relativePath of referencedFiles) {
    await assert.doesNotReject(() => readFile(resolve(projectRoot, "extension", relativePath)));
  }
});

