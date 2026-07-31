import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Manifest V3 references local files and required capabilities", async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.optional_permissions.includes("cookies"));
  assert.ok(manifest.optional_permissions.includes("power"));
  assert.ok(manifest.optional_permissions.includes("scripting"));
  assert.ok(manifest.optional_permissions.includes("tabCapture"));

  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    "deep-main.js",
    "deep-isolated.js",
    "power.js",
    "offscreen.html",
    "offscreen.js"
  ];
  for (const relativePath of referencedFiles) {
    await assert.doesNotReject(() => readFile(resolve(projectRoot, "extension", relativePath)));
  }
});

test("tab capture stays optional and never routes media through Native Messaging", async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "extension/manifest.json"), "utf8"));
  assert.ok(!manifest.permissions.includes("tabCapture"));

  const background = await readFile(resolve(projectRoot, "extension/background.js"), "utf8");
  assert.match(background, /chrome\.permissions\.contains\(\{ permissions: \["tabCapture"\] \}\)/);
  assert.match(background, /chrome\.downloads\.download\(/);

  const offscreen = await readFile(resolve(projectRoot, "extension/offscreen.js"), "utf8");
  assert.ok(!/nativeMessaging|connectNative|sendNativeMessage/.test(offscreen));
  assert.match(offscreen, /chromeMediaSource: "tab"/);
  assert.match(offscreen, /audioContext\.createMediaStreamSource\(stream\)\.connect\(audioContext\.destination\)/);
});
